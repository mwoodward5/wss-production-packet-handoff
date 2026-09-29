"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { isAutosendPending } = require("../lib/autosend");
const {
  buildPreviewForProspect: buildPreviewForProspectCore,
  runFullSystem,
} = require("../lib/full-run");
const { prospectId } = require("../lib/prospects");
const { truthPacketFromCanonical } = require("../lib/intake-genie-client");
const {
  mirrorLaneReleaseGated,
  CANONICAL_SITEFORGE_BUILD_URL,
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");
const { signEvidence } = require("../lib/mirror-engine/engine");

const NOW = Date.parse("2026-07-14T12:00:00.000Z");
const TEST_PREVIEW_CONSENT = Object.freeze({
  status: "granted",
  recorded_at: "2026-07-29T12:00:00.000Z",
  source: "test_fixture",
});

function durableConsentRow(prospect = {}) {
  return {
    ...structuredClone(prospect),
    prospect_id: prospectId(prospect),
    record: {
      ...(prospect.record && typeof prospect.record === "object"
        ? structuredClone(prospect.record)
        : {}),
      preview_build_consent: { ...TEST_PREVIEW_CONSENT },
    },
  };
}

async function buildPreviewForProspect(prospect = {}, options = {}) {
  const existingSelect = options.select;
  const mirrorBuildDouble = options.mirrorBuildDouble;
  const coreOptions = { ...options };
  delete coreOptions.mirrorBuildDouble;
  if (typeof mirrorBuildDouble === "function") {
    // Test the production Mirror seam, never the retired SiteForge injection.
    // The structured first argument keeps the old owner-claim/truth assertions
    // readable while the returned value is the real Mirror builder contract.
    coreOptions.buildMirrorForProspect = async (buildProspect, buildOptions = {}) => mirrorBuildDouble({
      prospect: buildProspect,
      truthPacket: buildProspect.truth_packet,
      job: { id: buildOptions.operationKey || "" },
      awaitTerminal: options.awaitTerminal === true,
      buildDeadlineAt: options.buildDeadlineAt,
      deadlineAt: options.deadlineAt,
    }, buildOptions);
  }
  let consentReadComplete = false;
  return buildPreviewForProspectCore(prospect, {
    ...coreOptions,
    select: async (...args) => {
      if (!consentReadComplete) {
        consentReadComplete = true;
        return { ok: true, mode: "test_fixture", data: [durableConsentRow(prospect)] };
      }
      return existingSelect
        ? existingSelect(...args)
        : { ok: true, mode: "test_fixture", data: [] };
    },
  });
}

test("packaged mirror lane stays disabled until it can emit real release evidence", () => {
  assert.equal(mirrorLaneReleaseGated({ SITEFORGE_MIRROR_LANE: "true" }), false);
  assert.equal(mirrorLaneReleaseGated({
    SITEFORGE_MIRROR_LANE: "true",
    SITEFORGE_MIRROR_RELEASE_GATED: "false",
  }), false);
  assert.equal(mirrorLaneReleaseGated({
    SITEFORGE_MIRROR_LANE: "true",
    SITEFORGE_MIRROR_RELEASE_GATED: "true",
  }), false);
});

const MIRROR_PREVIEW_URL = "https://preview-offer-test.wss-ai.com/";
const MIRROR_BUILD_HASH = "a".repeat(64);
const MIRROR_FINGERPRINT = `mirror-engine:${MIRROR_BUILD_HASH}`;

function passingMirrorBuild(overrides = {}) {
  const manifest = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: MIRROR_BUILD_HASH,
    donor: "plumbing-premium-donor",
    donor_content_hash: "b".repeat(64),
    slug: "preview-offer-test",
    deploy_id: "dpl_preview_offer_test",
    deploy_url: "https://preview-offer-test.vercel.app/",
    preview_url: MIRROR_PREVIEW_URL,
    checks: { render: { status: "passed" }, route_render: { status: "passed" } },
    revealable: true,
  };
  manifest.evidence_sha = signEvidence(manifest);
  return {
    ok: true,
    revealable: true,
    preview_url: MIRROR_PREVIEW_URL,
    slug: manifest.slug,
    donor: manifest.donor,
    vertical: "plumbing",
    photoCount: 2,
    contentCoverage: { services: 1, reviews: 0, hours: 0 },
    build_hash: MIRROR_BUILD_HASH,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: manifest.evidence_sha,
    release_evidence: manifest,
    ...overrides,
  };
}

function ownerProofProspect(id = "owner-proof") {
  return {
    prospect_id: id,
    business_name: "Owner Proof Plumbing",
    email: "owner@example.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    updated_at: "2026-07-28T06:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
    autosend: {
      run_id: "older-owner-proof",
      sandbox_mode: true,
      status: "pending",
    },
  };
}

function conditionalProspectStore(prospect, { normalizeReturnedTimestamps = false } = {}) {
  let state = {
    ...prospect,
    status: prospect.status || "new",
    record: structuredClone(prospect),
  };
  const writes = [];
  const returnedRows = [];
  const guardCalls = [];
  return {
    get state() {
      return structuredClone(state);
    },
    writes,
    returnedRows,
    guardCalls,
    update: async (table, idColumn, idValue, guards, patch) => {
      assert.equal(table, "ghost_agency_prospects");
      assert.equal(idColumn, "prospect_id");
      assert.equal(idValue, prospect.prospect_id);
      guardCalls.push(structuredClone(guards));
      const matches = Object.entries(guards).every(([column, filter]) => {
        const path = column.replace(/->>/g, "->").split("->");
        let value = state;
        for (const key of path) value = value?.[key];
        if (filter === "is.null") return value === undefined || value === null;
        if (!String(filter).startsWith("eq.")) return false;
        return String(value) === String(filter).slice(3);
      });
      if (!matches) return { ok: true, mode: "live_update", updated: false, rows: [] };
      state = { ...state, ...structuredClone(patch), prospect_id: prospect.prospect_id };
      writes.push(structuredClone(state));
      const returned = structuredClone(state);
      if (normalizeReturnedTimestamps && typeof returned.updated_at === "string") {
        returned.updated_at = returned.updated_at.replace(/Z$/, "+00:00");
      }
      returnedRows.push(structuredClone(returned));
      return { ok: true, mode: "live_update", updated: true, rows: [returned] };
    },
    replaceState(next) {
      state = structuredClone(next);
    },
  };
}

test("awaited owner proof durably claims autosend before dispatch and clears it before inline delivery", async () => {
  const prospect = ownerProofProspect("owner-proof-clears-autosend");
  const store = conditionalProspectStore(prospect, { normalizeReturnedTimestamps: true });
  const order = [];
  let awaitTerminal = false;
  const instants = [
    Date.parse("2026-07-28T06:01:00.000Z"),
    Date.parse("2026-07-28T06:02:00.000Z"),
    Date.parse("2026-07-28T06:03:00.000Z"),
  ];
  let instantIndex = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-autosend-clear-test",
    awaitTerminal: true,
    autosend: null,
    now: () => instants[Math.min(instantIndex++, instants.length - 1)],
    mirrorBuildDouble: async (input) => {
      order.push("dispatch");
      assert.equal(order[0], "claim");
      assert.equal(isAutosendPending({ record: store.state.record }), false);
      awaitTerminal = input.awaitTerminal;
      return passingMirrorBuild();
    },
    conditionalUpdate: async (...args) => {
      const result = await store.update(...args);
      const current = result.rows?.[0]?.record || {};
      order.push(current.autosend?.status === "owner_proof_claimed" ? "claim" : "final");
      return result;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(awaitTerminal, true);
  assert.deepEqual(order, ["claim", "dispatch", "final"]);
  assert.equal(store.writes.length, 2);
  assert.ok(store.writes.every((row) => /\.000Z$/.test(row.updated_at)));
  assert.ok(store.returnedRows.every((row) => /\.000\+00:00$/.test(row.updated_at)));
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

test("awaited owner proof fails closed before dispatch when its durable autosend claim is unproven", async () => {
  let dispatches = 0;
  const result = await buildPreviewForProspect(ownerProofProspect("owner-proof-claim-fails"), {
    source: "owner-proof-autosend-claim-failure-test",
    awaitTerminal: true,
    autosend: null,
    mirrorBuildDouble: async () => {
      dispatches += 1;
      return passingMirrorBuild();
    },
    conditionalUpdate: async () => ({ mode: "live_update", updated: false, rows: [] }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_autosend_claim_unproven");
  assert.equal(dispatches, 0);
});

test("expired owner build cutoff starts no truth, claim, persistence, or Mirror side effect", async () => {
  const prospect = ownerProofProspect("owner-proof-expired-before-truth");
  prospect.truth_packet = {};
  prospect.truth_packet_source = "places_basic";
  let truthCalls = 0;
  let claimCalls = 0;
  let upsertCalls = 0;
  let dispatches = 0;

  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    buildDeadlineAt: 100,
    requestDeadlineAt: 200,
    deadlineNow: () => 101,
    truthPacketWithLocalPlan: async () => {
      truthCalls += 1;
      return strongTruthPacket();
    },
    conditionalUpdate: async () => {
      claimCalls += 1;
      return { mode: "live_update", updated: true, rows: [] };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      return { mode: "live_upsert" };
    },
    mirrorBuildDouble: async () => {
      dispatches += 1;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.equal(truthCalls, 0);
  assert.equal(claimCalls, 0);
  assert.equal(upsertCalls, 0);
  assert.equal(dispatches, 0);
});

test("owner build cutoff expiring during truth compilation stops before claim or dispatch", async () => {
  const prospect = ownerProofProspect("owner-proof-expired-after-truth");
  prospect.truth_packet = {};
  prospect.truth_packet_source = "places_basic";
  let deadlineNow = 50;
  let truthCalls = 0;
  let claimCalls = 0;
  let dispatches = 0;

  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    buildDeadlineAt: 100,
    requestDeadlineAt: 200,
    deadlineNow: () => deadlineNow,
    truthPacketWithLocalPlan: async () => {
      truthCalls += 1;
      deadlineNow = 101;
      return strongTruthPacket();
    },
    conditionalUpdate: async () => {
      claimCalls += 1;
      return { mode: "live_update", updated: true, rows: [] };
    },
    mirrorBuildDouble: async () => {
      dispatches += 1;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.equal(truthCalls, 1);
  assert.equal(claimCalls, 0);
  assert.equal(dispatches, 0);
});

test("owner truth compilation is aborted at build cutoff with no late side effect", async () => {
  const prospect = ownerProofProspect("owner-proof-aborted-truth");
  prospect.truth_packet = {};
  prospect.truth_packet_source = "places_basic";
  const started = Date.now();
  let lateTruthMutations = 0;
  let claimCalls = 0;

  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    buildDeadlineAt: started + 60,
    requestDeadlineAt: started + 180,
    truthPacketWithLocalPlan: async (_prospect, _source, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lateTruthMutations += 1;
        resolve(strongTruthPacket());
      }, 120);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("truth aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
    conditionalUpdate: async () => {
      claimCalls += 1;
      return { mode: "live_update", updated: true, rows: [] };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.equal(lateTruthMutations, 0);
  assert.equal(claimCalls, 0);
});

test("owner finalization may complete after build cutoff while total request budget remains", async () => {
  const prospect = ownerProofProspect("owner-proof-finalize-after-build-cutoff");
  const store = conditionalProspectStore(prospect);
  let deadlineNow = 50;

  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    autosend: null,
    buildDeadlineAt: 100,
    requestDeadlineAt: 200,
    deadlineNow: () => deadlineNow,
    conditionalUpdate: store.update,
    mirrorBuildDouble: async (input) => {
      assert.equal(input.buildDeadlineAt, 100);
      deadlineNow = 101;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(store.writes.length, 2);
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

test("expired total request budget starts no final conditional write", async () => {
  const prospect = ownerProofProspect("owner-proof-expired-before-final-write");
  const store = conditionalProspectStore(prospect);
  let deadlineNow = 50;
  let conditionalCalls = 0;

  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    autosend: null,
    buildDeadlineAt: 100,
    requestDeadlineAt: 200,
    deadlineNow: () => deadlineNow,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      return store.update(...args);
    },
    mirrorBuildDouble: async () => {
      deadlineNow = 201;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(result.persistence, "owner_proof_request_deadline_exhausted");
  assert.equal(conditionalCalls, 1);
  assert.equal(store.writes.length, 1);
});

test("owner claim and final PATCH waits are bounded by their separate deadlines", async (t) => {
  await t.test("claim uses build cutoff", async () => {
    const prospect = ownerProofProspect("owner-proof-bounded-claim");
    const started = Date.now();
    let dispatches = 0;
    let lateMutations = 0;
    const result = await buildPreviewForProspect(prospect, {
      awaitTerminal: true,
      buildDeadlineAt: started + 80,
      requestDeadlineAt: started + 240,
      conditionalUpdate: async (_table, _idColumn, _idValue, _guards, _patch, { signal }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          lateMutations += 1;
          resolve({ mode: "live_update", updated: true, rows: [] });
        }, 160);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("claim aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
      mirrorBuildDouble: async () => {
        dispatches += 1;
        return passingMirrorBuild();
      },
    });

    assert.equal(result.blocked, "owner_proof_autosend_claim_unproven");
    assert.equal(result.persistence, "owner_proof_build_deadline_exhausted");
    assert.equal(dispatches, 0);
    assert.ok(Date.now() - started < 1_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(lateMutations, 0);
  });

  await t.test("final write uses total request deadline", async () => {
    const prospect = ownerProofProspect("owner-proof-bounded-final");
    const store = conditionalProspectStore(prospect);
    const started = Date.now();
    let conditionalCalls = 0;
    let lateMutations = 0;
    const result = await buildPreviewForProspect(prospect, {
      awaitTerminal: true,
      buildDeadlineAt: started + 100,
      requestDeadlineAt: started + 180,
      conditionalUpdate: async (...args) => {
        conditionalCalls += 1;
        if (conditionalCalls === 1) return store.update(...args);
        const { signal } = args[5];
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            lateMutations += 1;
            resolve({ mode: "live_update", updated: true, rows: [] });
          }, 260);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("final aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      },
      mirrorBuildDouble: async () => passingMirrorBuild(),
    });

    assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
    assert.equal(result.persistence, "owner_proof_request_deadline_exhausted");
    assert.equal(conditionalCalls, 2);
    assert.ok(Date.now() - started < 1_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(lateMutations, 0);
  });
});

test("two owner claims from the same durable version dispatch exactly one build", async () => {
  const prospect = ownerProofProspect("owner-proof-concurrent-claim");
  const store = conditionalProspectStore(prospect);
  let dispatches = 0;
  const options = {
    source: "owner-proof-concurrent-claim-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: store.update,
    mirrorBuildDouble: async () => {
      dispatches += 1;
      return passingMirrorBuild();
    },
  };

  const results = await Promise.all([
    buildPreviewForProspect(structuredClone(prospect), options),
    buildPreviewForProspect(structuredClone(prospect), options),
  ]);

  assert.equal(dispatches, 1);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.blocked === "owner_proof_autosend_claim_unproven").length, 1);
});

test("a newer owner claim wins and makes the older build finalization hold", async () => {
  const prospect = ownerProofProspect("owner-proof-newer-claim");
  const store = conditionalProspectStore(prospect);
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-newer-claim-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: store.update,
    mirrorBuildDouble: async () => {
      const current = store.state;
      store.replaceState({
        ...current,
        updated_at: "2026-07-28T06:05:00.000Z",
        record: {
          ...current.record,
          autosend: {
            sandbox_mode: true,
            status: "owner_proof_claimed",
            claim_id: "newer-owner-claim",
          },
        },
      });
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(result.preview_url, null);
});

test("owner finalization re-reads and safely rebases when an automated write preserves its exact claim", async () => {
  const prospect = ownerProofProspect("owner-proof-preserved-claim-rebase");
  const store = conditionalProspectStore(prospect);
  let conditionalCalls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-preserved-claim-rebase-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      return store.update(...args);
    },
    select: async (table, query) => {
      assert.equal(table, "ghost_agency_prospects");
      assert.match(query, /prospect_id=in\.\("owner-proof-preserved-claim-rebase"\)/);
      return { ok: true, mode: "live_select", data: [store.state] };
    },
    mirrorBuildDouble: async () => {
      const claimed = store.state;
      store.replaceState({
        ...claimed,
        updated_at: "2026-07-28T06:01:30.000Z",
        record: {
          ...claimed.record,
          business_name: "Concurrent identity stays intact",
          callback_observation: "preserve-me",
        },
      });
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistence, "live_update");
  assert.equal(conditionalCalls, 3);
  assert.equal(store.state.record.business_name, "Concurrent identity stays intact");
  assert.equal(store.state.record.callback_observation, "preserve-me");
  assert.equal(store.state.record.siteforge_generation_fingerprint, MIRROR_FINGERPRINT);
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

function exactReadyStateWithoutOwnerClaim(claimed, build, operationKey) {
  const record = {
    ...claimed.record,
    status: "previewed",
    report_url: null,
    preview_url: build.preview_url,
    siteforge_qc_passed: true,
    siteforge_visual_qc_passed: true,
    siteforge_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    siteforge_renderer: MIRROR_ENGINE_RENDERER,
    siteforge_generation_fingerprint: MIRROR_FINGERPRINT,
    build_dispatch: {
      ready: true,
      pending: false,
      job_id: operationKey,
      report_url: null,
      preview_url: build.preview_url,
      renderer: MIRROR_ENGINE_RENDERER,
      generation_fingerprint: MIRROR_FINGERPRINT,
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      release_evidence: build.release_evidence,
    },
  };
  delete record.autosend;
  return {
    ...claimed,
    status: "previewed",
    report_url: null,
    preview_url: build.preview_url,
    updated_at: "2026-07-28T12:00:30.000Z",
    record,
  };
}

test("owner finalization safely reacquires its exact ready build after persistence drops the claim", async () => {
  const prospect = ownerProofProspect("owner-proof-ready-build-lost-claim");
  const store = conditionalProspectStore(prospect);
  const build = passingMirrorBuild();
  const operationKey = "job_vLnnqQVG02hT";
  let conditionalCalls = 0;
  let reads = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-ready-build-lost-claim-test",
    awaitTerminal: true,
    autosend: null,
    operationKey,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      return store.update(...args);
    },
    select: async () => {
      reads += 1;
      return { ok: true, mode: "live_select", data: [store.state] };
    },
    mirrorBuildDouble: async () => {
      store.replaceState(exactReadyStateWithoutOwnerClaim(store.state, build, operationKey));
      return build;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistence, "live_update");
  assert.equal(conditionalCalls, 3);
  assert.equal(reads, 1);
  assert.equal(store.guardCalls[2]["record->autosend"], "is.null");
  assert.equal(
    store.guardCalls[2]["record->build_dispatch->>job_id"],
    `eq.${operationKey}`,
  );
  assert.equal(
    store.guardCalls[2]["record->build_dispatch->>generation_fingerprint"],
    `eq.${MIRROR_FINGERPRINT}`,
  );
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
  assert.equal(store.state.record.build_dispatch.job_id, operationKey);
  for (const [guard, expected] of Object.entries({
    "record->build_dispatch->>pending": "eq.false",
    "record->build_dispatch->>qc_passed": "eq.true",
    "record->build_dispatch->>visual_qc_passed": "eq.true",
    "record->build_dispatch->>renderer": `eq.${MIRROR_ENGINE_RENDERER}`,
    "record->build_dispatch->>qc_contract": `eq.${MIRROR_ENGINE_QC_CONTRACT}`,
  })) {
    assert.equal(store.guardCalls[2][guard], expected);
  }
});

test("owner finalization never reacquires a different ready build after its claim is lost", async () => {
  const prospect = ownerProofProspect("owner-proof-different-build-lost-claim");
  const store = conditionalProspectStore(prospect);
  const build = passingMirrorBuild();
  const operationKey = "job_owner_requested";
  let conditionalCalls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-different-build-lost-claim-test",
    awaitTerminal: true,
    autosend: null,
    operationKey,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      return store.update(...args);
    },
    select: async () => ({ ok: true, mode: "live_select", data: [store.state] }),
    mirrorBuildDouble: async () => {
      const claimed = store.state;
      const record = {
        ...claimed.record,
        status: "previewed",
        report_url: null,
        preview_url: build.preview_url,
        build_dispatch: {
          ready: true,
          pending: false,
          job_id: "job_newer_different",
          renderer: MIRROR_ENGINE_RENDERER,
          generation_fingerprint: "different-generation-v8",
          qc_passed: true,
          visual_qc_passed: true,
          qc_contract: MIRROR_ENGINE_QC_CONTRACT,
          release_evidence: build.release_evidence,
        },
      };
      delete record.autosend;
      store.replaceState({
        ...claimed,
        status: "previewed",
        report_url: null,
        preview_url: build.preview_url,
        updated_at: "2026-07-28T12:00:30.000Z",
        record,
      });
      return build;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(result.preview_url, null);
  assert.equal(conditionalCalls, 2);
  assert.equal(store.state.record.build_dispatch.job_id, "job_newer_different");
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

test("owner finalization fails closed when claim-loss proof is incomplete or mismatched", async (t) => {
  const cases = [
    ["wrong job", (row) => { row.record.build_dispatch.job_id = "job_other"; }],
    ["wrong fingerprint", (row) => {
      row.record.build_dispatch.generation_fingerprint = "other-generation";
    }],
    ["failed QC", (row) => { row.record.build_dispatch.qc_passed = false; }],
    ["wrong nested URL", (row) => {
      row.record.build_dispatch.preview_url = "https://previews.wss-ai.com/other";
    }],
    ["wrong status", (row) => { row.status = "new"; }],
    ["suppression", (row) => { row.record.do_not_contact = true; }],
    ["missing record identity", (row) => { delete row.record.prospect_id; }],
    ["missing mirrored QC", (row) => { delete row.record.siteforge_visual_qc_passed; }],
    ["missing proof", (row) => { delete row.record.build_dispatch.release_evidence; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const prospect = ownerProofProspect(`owner-proof-lost-claim-${name.replace(/\W+/g, "-")}`);
      const store = conditionalProspectStore(prospect);
      const build = passingMirrorBuild();
      const operationKey = "job_owner_requested";
      let conditionalCalls = 0;
      const result = await buildPreviewForProspect(prospect, {
        awaitTerminal: true,
        autosend: null,
        operationKey,
        conditionalUpdate: async (...args) => {
          conditionalCalls += 1;
          return store.update(...args);
        },
        select: async () => ({ ok: true, mode: "live_select", data: [store.state] }),
        mirrorBuildDouble: async () => {
          const row = exactReadyStateWithoutOwnerClaim(store.state, build, operationKey);
          mutate(row);
          store.replaceState(row);
          return build;
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
      assert.equal(result.preview_url, null);
      assert.equal(conditionalCalls, 2);
    });
  }
});

test("owner finalization holds when the exact-build reacquire CAS misses", async () => {
  const prospect = ownerProofProspect("owner-proof-exact-build-cas-miss");
  const store = conditionalProspectStore(prospect);
  const build = passingMirrorBuild();
  const operationKey = "job_exact_but_raced";
  let conditionalCalls = 0;
  let reads = 0;
  const result = await buildPreviewForProspect(prospect, {
    awaitTerminal: true,
    autosend: null,
    operationKey,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      if (conditionalCalls === 3) {
        return { ok: true, mode: "live_update", updated: false, rows: [] };
      }
      return store.update(...args);
    },
    select: async () => {
      reads += 1;
      return { ok: true, mode: "live_select", data: [store.state] };
    },
    mirrorBuildDouble: async () => {
      store.replaceState(exactReadyStateWithoutOwnerClaim(store.state, build, operationKey));
      return build;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(result.preview_url, null);
  assert.equal(conditionalCalls, 3);
  assert.equal(reads, 2);
});

test("owner finalization proves an exact persisted row after the PATCH response is lost", async () => {
  const prospect = ownerProofProspect("owner-proof-lost-final-response");
  const store = conditionalProspectStore(prospect);
  let conditionalCalls = 0;
  let reads = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-lost-final-response-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      const persisted = await store.update(...args);
      if (conditionalCalls === 2) {
        return { mode: "live_update_aborted", updated: false, rows: [] };
      }
      return persisted;
    },
    select: async () => {
      reads += 1;
      return { ok: true, mode: "live_select", data: [store.state] };
    },
    mirrorBuildDouble: async () => passingMirrorBuild(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.persistence, "live_update_reread_verified");
  assert.equal(conditionalCalls, 2);
  assert.equal(reads, 1);
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

test("owner finalization never rebases across a concurrent do-not-contact transition", async () => {
  const prospect = ownerProofProspect("owner-proof-concurrent-dnc");
  const store = conditionalProspectStore(prospect);
  let conditionalCalls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-concurrent-dnc-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: async (...args) => {
      conditionalCalls += 1;
      return store.update(...args);
    },
    select: async () => ({ ok: true, mode: "live_select", data: [store.state] }),
    mirrorBuildDouble: async () => {
      const claimed = store.state;
      store.replaceState({
        ...claimed,
        status: "do_not_contact",
        updated_at: "2026-07-28T06:01:30.000Z",
      });
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(conditionalCalls, 2);
  assert.equal(store.state.status, "do_not_contact");
  assert.equal(store.state.record.autosend.status, "owner_proof_claimed");
});

test("owner build final write failure is held and never becomes inline-sendable", async () => {
  const prospect = ownerProofProspect("owner-proof-final-write-fails");
  const store = conditionalProspectStore(prospect);
  let calls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "owner-proof-final-write-failure-test",
    awaitTerminal: true,
    autosend: null,
    conditionalUpdate: async (...args) => {
      calls += 1;
      if (calls === 1) return store.update(...args);
      return { mode: "live_update_failed", updated: false, rows: [] };
    },
    mirrorBuildDouble: async () => passingMirrorBuild(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.blocked, "owner_proof_final_persistence_unproven");
  assert.equal(result.report_url, null);
  assert.equal(result.preview_url, null);
});

function strongTruthPacket() {
  const evidence = [{
    field: "services",
    value: ["Drain cleaning"],
    source_type: "website",
    source_url: "https://source-business.test/services",
    confidence: 0.95,
  }];
  return {
    meta: { source: "intake_genie", bounded: true },
    services: ["Drain cleaning"],
    photos: ["https://source-business.test/drain-cleaning.webp"],
    localSearchPlan: { citations: evidence },
    intakeGenie: {
      status: "complete",
      facts: { services: ["Drain cleaning"] },
      evidence,
      assets: [
        {
          kind: "logo",
          url: "https://source-business.test/logo.svg",
          source: "website",
          origin: "source-intake",
          approved: true,
        },
        {
          kind: "photo",
          url: "https://source-business.test/drain-cleaning.webp",
          source: "website",
          origin: "source-intake",
          approved: true,
        },
      ],
    },
  };
}

function truthPacketForVertical(vertical, services) {
  const packet = strongTruthPacket();
  packet.identity = { category: { value: vertical, confidence: 0.95 } };
  packet.services = services;
  packet.intakeGenie.facts = { category: vertical, services };
  packet.intakeGenie.evidence[0].value = services;
  packet.localSearchPlan.citations = packet.intakeGenie.evidence;
  return packet;
}

async function capturedBuildIndustry({ id, prospectIndustry, truthVertical, services }) {
  const truthPacket = truthPacketForVertical(truthVertical, services);
  let dispatchedIndustry = null;
  const result = await buildPreviewForProspect({
    prospect_id: id,
    business_name: `${truthVertical} Test Business`,
    email: `owner@${id}.test`,
    industry: prospectIndustry,
    city: "Irvine",
    state: "CA",
    services,
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket,
  }, {
    source: "build-industry-test",
    persist: false,
    mirrorBuildDouble: async ({ prospect }) => {
      dispatchedIndustry = prospect.industry;
      return passingMirrorBuild();
    },
  });
  assert.equal(result.ok, true);
  return dispatchedIndustry;
}

test("generic top-level categories fall back to approved landscaping and roofing truth", async (t) => {
  for (const scenario of [
    { id: "truth-landscaping", truthVertical: "landscaper", services: ["Landscaping design"], expected: "landscaping" },
    { id: "truth-roofing", truthVertical: "roofing", services: ["Roofing repair"], expected: "roofing" },
  ]) {
    await t.test(scenario.expected, async () => {
      const industry = await capturedBuildIndustry({
        ...scenario,
        prospectIndustry: "local service",
      });
      assert.equal(industry, scenario.expected);
    });
  }
});

test("an approved explicit top-level vertical takes precedence over truth fallback", async () => {
  const industry = await capturedBuildIndustry({
    id: "explicit-plumbing-precedence",
    prospectIndustry: "plumbing",
    truthVertical: "landscaping",
    services: ["Landscape design"],
  });
  assert.equal(industry, "plumbing");
});

test("unverified raw classifier facts cannot override source-backed service evidence", async () => {
  const truthPacket = strongTruthPacket();
  truthPacket.intakeGenie.facts = {
    category: "pool service",
    services: ["Pool cleaning"],
  };
  truthPacket.intakeGenie.evidence[0].value = ["Landscaping"];
  truthPacket.localSearchPlan.citations = truthPacket.intakeGenie.evidence;
  let dispatchedIndustry = null;
  const result = await buildPreviewForProspect({
    prospect_id: "raw-classifier-conflict",
    business_name: "Verified Landscape Business",
    industry: "local service",
    services: ["Pool cleaning"],
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket,
  }, {
    persist: false,
    mirrorBuildDouble: async ({ prospect }) => {
      dispatchedIndustry = prospect.industry;
      return passingMirrorBuild();
    },
  });
  assert.equal(result.ok, true);
  assert.equal(dispatchedIndustry, "landscaping");
});

test("raw truth category without verified source evidence fails closed", async () => {
  const truthPacket = strongTruthPacket();
  truthPacket.intakeGenie.facts = {
    category: "roofing",
    services: ["General local service"],
  };
  truthPacket.intakeGenie.evidence[0].value = ["General local service"];
  truthPacket.localSearchPlan.citations = truthPacket.intakeGenie.evidence;
  let dispatchCalls = 0;
  const result = await buildPreviewForProspect({
    prospect_id: "raw-category-only",
    business_name: "Unverified Category Business",
    industry: "local service",
    services: ["General local service"],
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket,
  }, {
    persist: false,
    mirrorBuildDouble: async () => {
      dispatchCalls += 1;
      return passingMirrorBuild();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "approved_vertical_required");
  assert.equal(dispatchCalls, 0);
});

test("build fails closed when neither the prospect nor truth packet has an approved vertical", async () => {
  const truthPacket = truthPacketForVertical("local service", ["General local service"]);
  let dispatchCalls = 0;
  const result = await buildPreviewForProspect({
    prospect_id: "no-approved-build-vertical",
    business_name: "Generic Service Business",
    industry: "local service",
    city: "Irvine",
    state: "CA",
    services: ["General local service"],
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket,
  }, {
    source: "build-industry-test",
    persist: false,
    mirrorBuildDouble: async () => {
      dispatchCalls += 1;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.blocked, "approved_vertical_required");
  assert.equal(result.persistence, "not_persisted");
  assert.equal(dispatchCalls, 0);
});

test("all pre-provider refusal holds require exact version and contact CAS proof", async () => {
  const scenarios = [
    {
      name: "incomplete LeadMiner packet",
      blocked: "leadminer_truth_packet_incomplete",
      prospect: {
        industry: "plumbing",
        truth_packet_source: "leadminer_mirror_ready",
        truth_packet: {
          meta: {
            source: "leadminer_mirror_ready",
            build_ready: false,
            missing_build_evidence: ["verified_logo"],
          },
        },
      },
    },
    {
      name: "Intake Genie refusal",
      blocked: "intake_genie_blocked",
      prospect: {
        industry: "plumbing",
        truth_packet_source: "places_basic",
        truth_packet: {},
      },
      truthPacketWithLocalPlan: async () => {
        const error = new Error("canonical Intake packet unavailable");
        error.code = "intake_genie_blocked";
        throw error;
      },
    },
    {
      name: "missing approved vertical",
      blocked: "approved_vertical_required",
      prospect: {
        industry: "local service",
        truth_packet_source: "intake_genie",
        truth_packet: truthPacketForVertical("local service", ["General local service"]),
      },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const prospect = {
      prospect_id: `pre-provider-cas-${index}`,
      business_name: `Pre-provider CAS ${scenario.name}`,
      email: `owner-${index}@pre-provider-cas.example`,
      city: "Irvine",
      state: "CA",
      services: ["General local service"],
      status: "new",
      updated_at: "2026-08-29T12:00:00.000Z",
      ...scenario.prospect,
    };
    let guards = null;
    let patch = null;
    let upsertCalls = 0;
    let mirrorCalls = 0;
    const result = await buildPreviewForProspect(prospect, {
      source: `pre-provider-cas-${index}`,
      now: () => Date.parse("2026-08-29T12:00:01.000Z"),
      ...(scenario.truthPacketWithLocalPlan
        ? { truthPacketWithLocalPlan: scenario.truthPacketWithLocalPlan }
        : {}),
      conditionalUpdate: async (_table, _idColumn, id, exactGuards, exactPatch) => {
        guards = structuredClone(exactGuards);
        patch = structuredClone(exactPatch);
        return {
          mode: "live_update",
          updated: true,
          // PostgREST returns JSON, so undefined object fields from the
          // in-memory patch are omitted on the exact row representation.
          rows: [JSON.parse(JSON.stringify({ prospect_id: id, ...exactPatch }))],
        };
      },
      upsertRow: async () => {
        upsertCalls += 1;
        throw new Error("pre-provider holds must never use an unconditional upsert");
      },
      mirrorBuildDouble: async () => {
        mirrorCalls += 1;
        return passingMirrorBuild();
      },
    });

    assert.equal(result.ok, false, scenario.name);
    assert.equal(result.blocked, scenario.blocked, scenario.name);
    assert.equal(result.status, "held", scenario.name);
    assert.equal(result.persistence, "live_update", scenario.name);
    assert.equal(upsertCalls, 0, scenario.name);
    assert.equal(mirrorCalls, 0, scenario.name);
    assert.equal(guards.updated_at, "eq.2026-08-29T12:00:00.000Z", scenario.name);
    assert.equal(guards.status, "eq.new", scenario.name);
    assert.equal(guards.email, `eq.owner-${index}@pre-provider-cas.example`, scenario.name);
    assert.equal(guards["record->preview_build_consent->>status"], "eq.granted", scenario.name);
    assert.equal(patch.status, "held", scenario.name);
    assert.equal(patch.report_url, null, scenario.name);
    assert.equal(patch.preview_url, null, scenario.name);
    assert.equal(patch.record.blocked_reason, scenario.blocked, scenario.name);
  }
});

test("a consented preview build clears the retired countdown and expiration mechanic", async () => {
  const rows = [];
  const result = await buildPreviewForProspect({
    prospect_id: "preview-offer-test",
    business_name: "Preview Offer Plumbing",
    email: "owner@preview-offer.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    place_id: "places-preview-offer-test",
    status: "new",
    updated_at: "2026-07-14T11:59:00.000Z",
    preview_expires_at: "2026-08-05T00:00:00.000Z",
  }, {
    source: "test",
    now: () => NOW,
    truthPacketWithLocalPlan: async () => ({ meta: { source: "test" }, localSearchPlan: {} }),
    mirrorBuildDouble: async () => passingMirrorBuild(),
    conditionalUpdate: async (_table, _idColumn, id, _guards, patch) => {
      const row = { prospect_id: id, ...structuredClone(patch) };
      rows.push(row);
      return { mode: "live_update", updated: true, rows: [structuredClone(row)] };
    },
  });

  assert.equal(result.preview_expires_at, null);
  assert.equal(result.prospect.preview_expires_at, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].preview_expires_at, null);
  assert.equal(rows[0].record.preview_expires_at, null);
});

test("normal final CAS accepts its exact PostgREST JSON-wire row", async () => {
  const prospect = {
    prospect_id: "normal-final-json-wire",
    business_name: "Normal Final JSON Plumbing",
    email: "owner@normal-final-json.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  let conditionalWrites = 0;
  let upsertCalls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "normal-final-json-wire-test",
    now: () => Date.parse("2026-08-29T12:00:01.000Z"),
    mirrorBuildDouble: async () => passingMirrorBuild(),
    conditionalUpdate: async (_table, _idColumn, id, _guards, patch) => {
      conditionalWrites += 1;
      return {
        mode: "live_update",
        updated: true,
        rows: [JSON.parse(JSON.stringify({ prospect_id: id, ...patch }))],
      };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      throw new Error("a normal final build must never use an unconditional upsert");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "previewed");
  assert.equal(result.preview_url, MIRROR_PREVIEW_URL);
  assert.equal(result.persistence, "live_update");
  assert.equal(conditionalWrites, 1);
  assert.equal(upsertCalls, 0);
});

test("a non-persisting build returns artifacts without changing the prospect row", async () => {
  const rows = [];
  const result = await buildPreviewForProspect({
    prospect_id: "owner-proof-build",
    business_name: "Owner Proof Plumbing",
    email: "owner-proof@real-business.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    place_id: "places-owner-proof-build",
    status: "new",
  }, {
    source: "owner-proof-test",
    persist: false,
    now: () => NOW,
    truthPacketWithLocalPlan: async () => ({ meta: { source: "test" }, localSearchPlan: {} }),
    mirrorBuildDouble: async () => passingMirrorBuild(),
    upsertRow: async (_table, row) => {
      rows.push(row);
      return { mode: "live_upsert" };
    },
  });

  assert.equal(rows.length, 0);
  assert.equal(result.persistence, "not_persisted");
  assert.equal(result.preview_expires_at, null);
});

test("composition slot is propagated into the Mirror Engine build input", async () => {
  let mirrorProspect;

  await buildPreviewForProspect({
    prospect_id: "composition-slot-build",
    business_name: "Composition Slot Plumbing",
    email: "owner@composition-slot.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    place_id: "places-composition-slot-build",
    status: "new",
  }, {
    source: "composition-slot-test",
    compositionSlot: 3,
    persist: false,
    now: () => NOW,
    truthPacketWithLocalPlan: async () => ({ meta: { source: "test" }, localSearchPlan: {} }),
    mirrorBuildDouble: async (input) => {
      mirrorProspect = input.prospect;
      return passingMirrorBuild();
    },
  });

  assert.equal(mirrorProspect.composition_slot, 3);
});

test("weak or stale truth packets are refreshed through the canonical intake path", async (t) => {
  const cases = [
    {
      name: "places_basic source",
      weaken(packet) {
        packet.meta.source = "places_basic";
      },
    },
    {
      name: "missing verified source logo",
      weaken(packet) {
        packet.intakeGenie.assets = packet.intakeGenie.assets.filter((asset) => asset.kind !== "logo");
      },
    },
    {
      name: "missing source photo or video",
      weaken(packet) {
        packet.intakeGenie.assets = packet.intakeGenie.assets.filter((asset) => !["photo", "video"].includes(asset.kind));
      },
    },
    {
      name: "missing verified service evidence",
      weaken(packet) {
        packet.intakeGenie.evidence = [];
        packet.localSearchPlan.citations = [];
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const weakPacket = strongTruthPacket();
      scenario.weaken(weakPacket);
      const refreshedPacket = strongTruthPacket();
      refreshedPacket.meta.generated_at = "2026-07-14T12:00:00.000Z";
      let refreshCalls = 0;
      let dispatchedTruthPacket;

      const result = await buildPreviewForProspect({
        prospect_id: `weak-packet-${scenario.name.replace(/\W+/g, "-")}`,
        business_name: "Weak Packet Plumbing",
        email: "owner@weak-packet.test",
        industry: "plumbing",
        city: "Irvine",
        state: "CA",
        services: ["Drain cleaning"],
        truth_packet_source: weakPacket.meta.source,
        truth_packet: weakPacket,
      }, {
        source: "weak-truth-test",
        persist: false,
        now: () => NOW,
        truthPacketWithLocalPlan: async (_prospect, source) => {
          refreshCalls += 1;
          assert.equal(source, "weak-truth-test");
          return refreshedPacket;
        },
        mirrorBuildDouble: async (input) => {
          dispatchedTruthPacket = input.truthPacket;
          return passingMirrorBuild();
        },
      });

      assert.equal(refreshCalls, 1);
      assert.strictEqual(dispatchedTruthPacket, refreshedPacket);
      assert.strictEqual(result.truth_packet, refreshedPacket);
      assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
      assert.equal(result.qc_passed, true);
    });
  }
});

test("HTTP first-party service evidence remains reusable downstream", async () => {
  const packet = strongTruthPacket();
  packet.intakeGenie.evidence[0].source_url = "http://source-business.test/services";
  packet.localSearchPlan.citations = packet.intakeGenie.evidence;
  let refreshCalls = 0;

  const result = await buildPreviewForProspect({
    prospect_id: "http-service-evidence-reuse",
    business_name: "HTTP Source Plumbing",
    email: "owner@http-source.test",
    current_website: "http://source-business.test/",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    truth_packet_source: packet.meta.source,
    truth_packet: packet,
  }, {
    source: "http-service-evidence-test",
    persist: false,
    truthPacketWithLocalPlan: async () => {
      refreshCalls += 1;
      return strongTruthPacket();
    },
    mirrorBuildDouble: async () => passingMirrorBuild(),
  });

  assert.equal(refreshCalls, 0);
  assert.equal(result.ok, true);
});

test("verified foreign and shared-tenant HTTP service evidence is refreshed", async (t) => {
  const scenarios = [
    {
      name: "foreign host",
      website: "http://source-business.test/",
      evidenceUrl: "http://foreign-business.test/services",
    },
    {
      name: "different Wix tenant",
      website: "http://mark.wixsite.com/alice/",
      evidenceUrl: "http://mark.wixsite.com/bob/services",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const packet = strongTruthPacket();
      packet.intakeGenie.evidence[0].source_url = scenario.evidenceUrl;
      packet.intakeGenie.evidence[0].verified = true;
      packet.localSearchPlan.citations = packet.intakeGenie.evidence;
      let refreshCalls = 0;

      const result = await buildPreviewForProspect({
        prospect_id: `http-service-refresh-${scenario.name.replace(/\W+/g, "-")}`,
        business_name: "HTTP Boundary Plumbing",
        email: "owner@http-boundary.test",
        current_website: scenario.website,
        industry: "plumbing",
        city: "Irvine",
        state: "CA",
        services: ["Drain cleaning"],
        truth_packet_source: packet.meta.source,
        truth_packet: packet,
      }, {
        source: "http-service-boundary-test",
        persist: false,
        truthPacketWithLocalPlan: async () => {
          refreshCalls += 1;
          return strongTruthPacket();
        },
        mirrorBuildDouble: async () => passingMirrorBuild(),
      });

      assert.equal(refreshCalls, 1);
      assert.equal(result.ok, true);
    });
  }
});

test("a strong source-backed truth packet is reused without another intake compile", async () => {
  const truthPacket = strongTruthPacket();
  let refreshCalls = 0;
  let dispatchedTruthPacket;

  const result = await buildPreviewForProspect({
    prospect_id: "strong-packet-reuse",
    business_name: "Strong Packet Plumbing",
    email: "owner@strong-packet.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket,
  }, {
    source: "strong-truth-test",
    persist: false,
    now: () => NOW,
    truthPacketWithLocalPlan: async () => {
      refreshCalls += 1;
      return strongTruthPacket();
    },
    mirrorBuildDouble: async (input) => {
      dispatchedTruthPacket = input.truthPacket;
      return passingMirrorBuild();
    },
  });

  assert.equal(refreshCalls, 0);
  assert.deepEqual(dispatchedTruthPacket, truthPacket);
  assert.deepEqual(result.truth_packet, truthPacket);
  assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.qc_passed, true);
});

test("fresh compiled intake truth reaches Mirror and replaces the stale wrapper", async () => {
  const staleTruthPacket = strongTruthPacket();
  staleTruthPacket.meta.source = "places_basic";
  staleTruthPacket.intakeGenie.facts.address = "Old donor address";
  staleTruthPacket.intakeGenie.assets[0].url = "https://stale-source.test/old-logo.svg";
  const freshCanonical = {
    version: "pagehub-intake-compiler-v2",
    status: "complete",
    facts: {
      name: "Fresh Truth Plumbing",
      city: "Irvine",
      state: "CA",
      category: "plumbing",
      address: "123 Current Way, Irvine, CA 92618",
      services: ["Drain cleaning"],
    },
    evidence: [{
      field: "services",
      value: ["Drain cleaning"],
      source_type: "website",
      source_url: "https://fresh-truth.test/services",
      confidence: 0.99,
    }],
    assets: [
      {
        kind: "logo",
        url: "https://fresh-truth.test/current-logo.svg",
        source: "website",
        origin: "source-intake",
        approved: true,
      },
      {
        kind: "photo",
        url: "https://fresh-truth.test/current-hero.webp",
        source: "website",
        origin: "source-intake",
        approved: true,
      },
    ],
    trust: { rating: 4.9, review_count: 88, reviews: [] },
    optimization: { target_queries: [], seo_gaps: [] },
  };
  const freshTruthPacket = truthPacketFromCanonical(freshCanonical);
  let dispatchedTruthPacket;
  const result = await buildPreviewForProspect({
    prospect_id: "fresh-compiled-truth",
    business_name: "Fresh Truth Plumbing",
    email: "owner@fresh-truth.test",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    truth_packet_source: "intake_genie",
    truth_packet: staleTruthPacket,
  }, {
    source: "fresh-compiled-truth-test",
    persist: false,
    truthPacketWithLocalPlan: async () => freshTruthPacket,
    mirrorBuildDouble: async (input) => {
      dispatchedTruthPacket = input.truthPacket;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, true);
  assert.strictEqual(dispatchedTruthPacket, freshTruthPacket);
  assert.strictEqual(result.truth_packet, freshTruthPacket);
  assert.strictEqual(result.truth_packet.intakeGenie, freshCanonical);
  assert.equal(result.truth_packet.identity.address.value, "123 Current Way, Irvine, CA 92618");
  assert.equal(result.truth_packet.intakeGenie.assets[0].url, "https://fresh-truth.test/current-logo.svg");
  assert.deepEqual(result.truth_packet.photos, ["https://fresh-truth.test/current-hero.webp"]);
  assert.equal(result.truth_packet.reviewThemes.count, 88);
});

test("an exact persisted legacy SiteForge job is read and drained without a fresh Mirror build", async () => {
  const rows = [];
  let receivedResume;
  let mirrorCalls = 0;
  const jobId = "siteforge-job-42";
  const statusUrl = `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`;
  const result = await buildPreviewForProspect({
    prospect_id: "durable-pending-build",
    business_name: "Durable Pending Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    record: {
      prospect_id: "durable-pending-build",
      status: "new",
      blocked_reason: "siteforge_build_pending",
      build_dispatch: {
        mode: "http_dispatch",
        ready: false,
        pending: true,
        job_id: jobId,
        status_url: statusUrl,
      },
    },
  }, {
    source: "siteforge_reconcile",
    dispatchSiteForgePreview: async (input) => {
      receivedResume = input.resume;
      return {
        mode: "existing_job_status_read",
        configured: true,
        pending: true,
        jobId,
        statusUrl,
        urls: {},
        buildStatus: {
          ready: false,
          pending: true,
          renderer: "05-build-v8",
          required_renderer: "05-build-v8",
          qc_passed: false,
          visual_qc_passed: false,
          blocked: [],
        },
      };
    },
    buildMirrorForProspect: async () => {
      mirrorCalls += 1;
      throw new Error("fresh Mirror must not run while exact legacy work drains");
    },
    conditionalUpdate: async (_table, _idColumn, id, _guards, patch) => {
      const row = { prospect_id: id, ...structuredClone(patch) };
      rows.push(row);
      return { mode: "live_update", updated: true, rows: [structuredClone(row)] };
    },
  });

  assert.deepEqual(receivedResume, { job_id: jobId, status_url: statusUrl });
  assert.equal(mirrorCalls, 0);
  assert.equal(result.pending, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, "new");
  assert.equal(result.preview_url, null);
  assert.equal(result.report_url, null);
  assert.equal(result.dispatch.mode, "existing_job_status_read");
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.legacy_siteforge_drained, true);
  assert.equal(rows[0].record.build_dispatch.pending, true);
  assert.equal(rows[0].record.build_dispatch.mode, "existing_job_status_read");
  assert.equal(rows[0].record.build_dispatch.job_id, jobId);
  assert.equal(rows[0].record.build_dispatch.status_url, statusUrl);
  assert.equal(rows[0].record.blocked_reason, "siteforge_build_pending");
  assert.equal(result.blocked, "siteforge_build_pending");
});

test("Mirror Engine refusal fails closed and preserves its exact blocker", async () => {
  const mirrorBlocked = "vertical_retired_for_outreach";
  let refusalDiagnostic;
  const result = await buildPreviewForProspect({
    prospect_id: "mirror-no-donor",
    business_name: "Mirror Roofing",
    industry: "roofing",
    city: "Irvine",
    state: "CA",
    services: ["Roof repair"],
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  }, {
    source: "mirror-summary-test",
    persist: false,
    mirrorBuildDouble: async () => ({
      ok: false,
      reason: mirrorBlocked,
      detail: ["roofing has no approved outreach donor"],
    }),
    onMirrorRefusal: (diagnostic) => {
      refusalDiagnostic = diagnostic;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.blocked, mirrorBlocked);
  assert.equal(result.dispatch.mode, "mirror_lane");
  assert.equal(result.dispatch.configured, true);
  assert.equal(result.dispatch.ready, false);
  assert.equal(result.dispatch.pending, false);
  assert.deepEqual(result.dispatch.blocked, [mirrorBlocked]);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.legacy_siteforge_drained, false);
  assert.equal(refusalDiagnostic.reason, mirrorBlocked);
  assert.deepEqual(refusalDiagnostic.detail, ["roofing has no approved outreach donor"]);
});

test("Mirror fleet outages remain retryable system holds in the direct owner-build flow", async () => {
  const result = await buildPreviewForProspect({
    prospect_id: "mirror-fleet-system-hold",
    business_name: "Fleet Hold Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  }, {
    source: "mirror-fleet-system-hold-test",
    persist: false,
    mirrorBuildDouble: async () => ({
      ok: false,
      status: 503,
      reason: "mirror_fleet_read_unavailable",
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      system_hold: {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_read_unavailable",
        retryable: true,
        scope: "mirror_build",
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "new", "a system outage is retryable, not a held lead rejection");
  assert.equal(result.pending, true);
  assert.equal(result.retryable, true);
  assert.equal(result.disposition, "system_hold");
  assert.equal(result.lead_rejection, false);
  assert.equal(result.reason, "mirror_fleet_read_unavailable");
  assert.equal(result.blocked, "mirror_fleet_read_unavailable");
  assert.equal(result.dispatch.retryable, true);
  assert.equal(result.dispatch.disposition, "system_hold");
  assert.equal(result.dispatch.lead_rejection, false);
  assert.equal(result.dispatch.system_hold.code, "mirror_fleet_read_unavailable");
});

test("a deployed Mirror awaiting fleet reconciliation is held and excluded from the next nightly build", async () => {
  const writes = [];
  const guardsSeen = [];
  let mirrorCalls = 0;
  let upsertCalls = 0;
  let persisted = null;
  // The legacy Vercel release carries deploy identity but no shared-site
  // proofIdentity. It is still exact HMAC-signed release evidence.
  const releaseEvidence = structuredClone(passingMirrorBuild().release_evidence);
  releaseEvidence.checks.brand = {
    status: "passed",
    accent_hex: "#123456",
    accent_origin: "measured_from_site_chrome",
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    redeploy_allowed: false,
    release: {
      build_hash: MIRROR_BUILD_HASH,
      preview_url: MIRROR_PREVIEW_URL,
      deploy_id: releaseEvidence.deploy_id,
      deploy_url: releaseEvidence.deploy_url,
      evidence_sha: releaseEvidence.evidence_sha,
    },
    fleet_identity: {
      slug: releaseEvidence.slug,
      h1: "Fleet Hold Plumbing",
      title: "Fleet Hold Plumbing",
      prospect_id: "mirror-fleet-record-hold",
      donor: releaseEvidence.donor,
      build_hash: MIRROR_BUILD_HASH,
      attempt: 1,
    },
  };
  const prospect = {
    prospect_id: "mirror-fleet-record-hold",
    business_name: "Fleet Hold Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  const options = {
    source: "mirror-fleet-record-hold-test",
    compositionSlot: 2,
    now: () => Date.parse(prospect.updated_at),
    mirrorBuildDouble: async () => {
      mirrorCalls += 1;
      return {
        ok: false,
        status: 503,
        reason: "mirror_fleet_record_unavailable",
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        reconciliation,
        release_evidence: releaseEvidence,
        system_hold: {
          schema: "wss.mirror.system_hold.v1",
          type: "system",
          code: "mirror_fleet_record_unavailable",
          retryable: true,
          scope: "mirror_reconciliation",
          manual_reconciliation_required: true,
          reconciliation,
        },
      };
    },
    conditionalUpdate: async (_table, _idColumn, id, guards, patch) => {
      guardsSeen.push(structuredClone(guards));
      writes.push(structuredClone(patch));
      persisted = { prospect_id: id, ...structuredClone(patch) };
      return {
        mode: "live_update",
        updated: true,
        rows: [structuredClone(persisted)],
      };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      throw new Error("post-deploy reconciliation must use CAS, not upsert");
    },
  };
  const result = await buildPreviewForProspect(prospect, options);
  const replay = await buildPreviewForProspect(persisted, options);

  assert.equal(replay.ok, false);
  assert.equal(replay.status, "held");
  assert.equal(replay.persistence, "persisted_reconciliation_hold");
  assert.equal(replay.rebuild_allowed, false);
  assert.equal(replay.redeploy_allowed, false);
  assert.deepEqual(replay.reconciliation, reconciliation);
  assert.deepEqual(replay.release_evidence, releaseEvidence);
  assert.equal(mirrorCalls, 1, "a reveal poll replays the durable hold before Mirror/provider work");
  assert.equal(upsertCalls, 0);
  assert.equal(guardsSeen.length, 1);
  assert.equal(guardsSeen[0].updated_at, `eq.${prospect.updated_at}`);
  assert.equal(guardsSeen[0].status, "eq.new");
  assert.equal(guardsSeen[0]["record->preview_build_consent->>status"], "eq.granted");

  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.preview_url, null);
  assert.equal(result.lead_rejection, false);
  assert.equal(result.provider_attempted, true);
  assert.equal(result.manual_reconciliation_required, true);
  assert.deepEqual(result.reconciliation, reconciliation);
  assert.deepEqual(result.release_evidence, releaseEvidence);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, "held");
  assert.equal(
    writes[0].updated_at,
    "2026-08-29T12:00:00.001Z",
    "the reconciliation CAS must advance the durable version even when its clock equals the base row",
  );
  assert.equal(writes[0].record.status, "held");
  assert.equal(writes[0].record.blocked_reason, "mirror_fleet_record_unavailable");
  assert.equal(writes[0].record.build_dispatch.system_hold.scope, "mirror_reconciliation");
  assert.equal(writes[0].record.build_dispatch.manual_reconciliation_required, true);
  assert.equal(writes[0].record.build_dispatch.redeploy_allowed, false);
  assert.equal(writes[0].record.brand_truth.accent, "#123456");
  assert.match(writes[0].record.build_dispatch.source_fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(writes[0].record.build_dispatch.reconciliation, reconciliation);
  assert.deepEqual(writes[0].record.build_dispatch.release_evidence, releaseEvidence);
  assert.equal(writes[0].status === "new", false, "nightly selects only status=new; this release cannot redeploy");
});

test("an uncertain reconciliation write reuses the exact stable operation receipt on the next poll", async (t) => {
  for (const scenario of [
    { name: "dry_run", mode: "dry_run", persistence: "dry_run" },
    { name: "live_update_failed", mode: "live_update_failed", persistence: "live_update_failed" },
    { name: "success-looking wrong mode", mode: "live_upsert", persistence: "live_upsert" },
    { name: "throw", throws: true, persistence: "live_update_failed" },
  ]) {
    await t.test(scenario.name, async () => {
      const failedMode = scenario.mode || "thrown";
      const prospect = {
        prospect_id: `reconciliation-write-${failedMode}`,
        business_name: "Reconciliation Write Plumbing",
        industry: "plumbing",
        city: "Irvine",
        state: "CA",
        services: ["Drain cleaning"],
        status: "new",
        updated_at: "2026-08-29T12:00:00.000Z",
        truth_packet_source: "intake_genie",
        truth_packet: strongTruthPacket(),
      };
      const releaseEvidence = {
        ...passingMirrorBuild().release_evidence,
        proofIdentity: {
          site_id: `site-${failedMode}`,
          release_id: `release-${failedMode}`,
          build_hash: MIRROR_BUILD_HASH,
        },
      };
      releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
      const reconciliation = {
        schema: "wss.mirror.fleet_reconciliation.v1",
        action: "record_fleet_identity",
        redeploy_allowed: false,
        release: {
          build_hash: MIRROR_BUILD_HASH,
          preview_url: MIRROR_PREVIEW_URL,
          deploy_id: releaseEvidence.deploy_id,
          deploy_url: releaseEvidence.deploy_url,
          evidence_sha: releaseEvidence.evidence_sha,
          proof_identity: releaseEvidence.proofIdentity,
        },
        fleet_identity: {
          slug: releaseEvidence.slug,
          h1: prospect.business_name,
          title: prospect.business_name,
          prospect_id: prospect.prospect_id,
          donor: releaseEvidence.donor,
          build_hash: MIRROR_BUILD_HASH,
          attempt: 1,
        },
      };
      const operationKeys = [];
      let upserts = 0;
      const mirrorBuildDouble = async (input) => {
        const operationKey = String(input.job.id || "");
        operationKeys.push(operationKey);
        return {
          ok: false,
          status: 503,
          reason: "mirror_fleet_record_unavailable",
          retryable: true,
          disposition: "system_hold",
          lead_rejection: false,
          reconciliation,
          release_evidence: releaseEvidence,
          system_hold: {
            schema: "wss.mirror.system_hold.v1",
            type: "system",
            code: "mirror_fleet_record_unavailable",
            retryable: true,
            scope: "mirror_reconciliation",
            manual_reconciliation_required: true,
            reconciliation,
          },
        };
      };
      const conditionalUpdate = async (_table, _idColumn, id, _guards, patch) => {
        upserts += 1;
        if (upserts === 1) {
          if (scenario.throws) throw new Error("simulated reconciliation CAS outage");
          return { mode: scenario.mode, updated: false, rows: [] };
        }
        return {
          mode: "live_update",
          updated: true,
          rows: [{ prospect_id: id, ...structuredClone(patch) }],
        };
      };

      const first = await buildPreviewForProspect(prospect, {
        source: "reconciliation-write-retry-test",
        mirrorBuildDouble,
        conditionalUpdate,
      });
      const second = await buildPreviewForProspect(prospect, {
        source: "reconciliation-write-retry-test",
        mirrorBuildDouble,
        conditionalUpdate,
      });

      assert.equal(first.ok, false);
      assert.equal(first.status, "new", "an unproven write cannot claim the durable row is held");
      assert.equal(first.blocked, "mirror_reconciliation_persistence_unproven");
      assert.equal(first.persistence_unproven, true);
      assert.equal(first.persistence, scenario.persistence);
      assert.equal(first.provider_attempted, true);
      assert.deepEqual(first.reconciliation, reconciliation);
      assert.deepEqual(first.release_evidence, releaseEvidence);
      assert.equal(second.status, "held");
      assert.equal(second.persistence, "live_update");
      assert.equal(operationKeys.length, 2);
      assert.equal(operationKeys[0], operationKeys[1], "the retry uses the exact same provider operation receipt");
      assert.match(operationKeys[0], /^mirror_build:[a-f0-9]{64}$/);
    });
  }
});

test("reconciliation persistence CAS cannot overwrite a concurrent STOP transition", async () => {
  const prospect = {
    prospect_id: "reconciliation-stop-race",
    business_name: "STOP Race Plumbing",
    email: "owner@stop-race.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  const releaseEvidence = passingMirrorBuild().release_evidence;
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    redeploy_allowed: false,
    release: {
      build_hash: MIRROR_BUILD_HASH,
      preview_url: MIRROR_PREVIEW_URL,
      deploy_id: releaseEvidence.deploy_id,
      deploy_url: releaseEvidence.deploy_url,
      evidence_sha: releaseEvidence.evidence_sha,
    },
    fleet_identity: {
      slug: releaseEvidence.slug,
      h1: prospect.business_name,
      title: prospect.business_name,
      prospect_id: prospect.prospect_id,
      donor: releaseEvidence.donor,
      build_hash: MIRROR_BUILD_HASH,
      attempt: 1,
    },
  };
  let upsertCalls = 0;
  let guards = null;
  const result = await buildPreviewForProspect(prospect, {
    source: "reconciliation-stop-race-test",
    mirrorBuildDouble: async () => ({
      ok: false,
      reason: "mirror_fleet_record_unavailable",
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      reconciliation,
      release_evidence: releaseEvidence,
      system_hold: {
        schema: "wss.mirror.system_hold.v1",
        type: "system",
        code: "mirror_fleet_record_unavailable",
        retryable: true,
        scope: "mirror_reconciliation",
        manual_reconciliation_required: true,
        reconciliation,
      },
    }),
    conditionalUpdate: async (_table, _idColumn, _id, exactGuards) => {
      guards = structuredClone(exactGuards);
      // A STOP writer changed updated_at/status before this CAS. Zero matching
      // rows proves the reconciliation writer did not overwrite it.
      return { mode: "live_update", updated: false, rows: [] };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      throw new Error("unsafe upsert must remain unreachable");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "mirror_reconciliation_persistence_unproven");
  assert.equal(result.persistence, "live_update");
  assert.equal(result.persistence_unproven, true);
  assert.equal(result.rebuild_allowed, false);
  assert.equal(result.redeploy_allowed, false);
  assert.equal(upsertCalls, 0);
  assert.equal(guards.updated_at, `eq.${prospect.updated_at}`);
  assert.equal(guards.status, "eq.new");
  assert.equal(guards.email, `eq.${prospect.email}`);
  assert.equal(guards["record->preview_build_consent->>status"], "eq.granted");
  assert.equal(guards["record->>do_not_contact"], "is.null");
});

test("Intake failure hold CAS cannot erase a STOP written during compilation", async () => {
  const initialUpdatedAt = "2026-08-29T12:00:00.000Z";
  const stoppedUpdatedAt = "2026-08-29T12:00:01.000Z";
  let state = durableConsentRow({
    prospect_id: "intake-stop-race",
    business_name: "Intake STOP Race Plumbing",
    email: "owner@intake-stop-race.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: initialUpdatedAt,
    truth_packet_source: "places_basic",
    truth_packet: {},
    record: {
      status: "new",
      email: "owner@intake-stop-race.example",
      do_not_contact: false,
    },
  });
  let guards = null;
  let upsertCalls = 0;
  let mirrorCalls = 0;

  const result = await buildPreviewForProspectCore(structuredClone(state), {
    source: "intake-stop-race-test",
    now: () => Date.parse("2026-08-29T12:00:02.000Z"),
    select: async () => ({ ok: true, mode: "test_fixture", data: [structuredClone(state)] }),
    truthPacketWithLocalPlan: async () => {
      state = {
        ...state,
        status: "do_not_contact",
        updated_at: stoppedUpdatedAt,
        record: {
          ...state.record,
          status: "do_not_contact",
          do_not_contact: true,
        },
      };
      const error = new Error("Intake unavailable after STOP landed");
      error.code = "intake_genie_blocked";
      throw error;
    },
    conditionalUpdate: async (_table, _idColumn, _id, exactGuards) => {
      guards = structuredClone(exactGuards);
      return { mode: "live_update", updated: false, rows: [] };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      throw new Error("unsafe early-hold upsert must remain unreachable");
    },
    buildMirrorForProspect: async () => {
      mirrorCalls += 1;
      return passingMirrorBuild();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.retryable, true);
  assert.equal(result.disposition, "system_hold");
  assert.equal(result.lead_rejection, false);
  assert.equal(result.blocked, "mirror_prebuild_persistence_unproven");
  assert.equal(result.cause_code, "intake_genie_blocked");
  assert.equal(result.persistence, "live_update");
  assert.equal(result.persistence_unproven, true);
  assert.equal(result.provider_attempted, false);
  assert.equal(upsertCalls, 0);
  assert.equal(mirrorCalls, 0);
  assert.equal(guards.updated_at, `eq.${initialUpdatedAt}`);
  assert.equal(guards.status, "eq.new");
  assert.equal(guards.email, "eq.owner@intake-stop-race.example");
  assert.equal(guards["record->>do_not_contact"], "eq.false");
  assert.equal(guards["record->preview_build_consent->>status"], "eq.granted");
  assert.equal(state.status, "do_not_contact");
  assert.equal(state.updated_at, stoppedUpdatedAt);
  assert.equal(state.record.do_not_contact, true);
});

test("a normal build final CAS cannot overwrite a concurrent STOP transition", async () => {
  const prospect = {
    prospect_id: "normal-build-stop-race",
    business_name: "Normal STOP Race Plumbing",
    email: "owner@normal-stop-race.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  let guards = null;
  let upsertCalls = 0;
  const result = await buildPreviewForProspect(prospect, {
    source: "normal-build-stop-race-test",
    mirrorBuildDouble: async () => passingMirrorBuild(),
    conditionalUpdate: async (_table, _idColumn, _id, exactGuards) => {
      guards = structuredClone(exactGuards);
      return { mode: "live_update", updated: false, rows: [] };
    },
    upsertRow: async () => {
      upsertCalls += 1;
      throw new Error("a provider result must never use an unconditional upsert");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "mirror_final_persistence_unproven");
  assert.equal(result.status, "new");
  assert.equal(result.preview_url, null);
  assert.equal(result.provider_attempted, true);
  assert.equal(result.manual_reconciliation_required, true);
  assert.equal(result.rebuild_allowed, false);
  assert.equal(result.redeploy_allowed, false);
  assert.equal(upsertCalls, 0);
  assert.equal(guards.updated_at, `eq.${prospect.updated_at}`);
  assert.equal(guards.status, "eq.new");
  assert.equal(guards.email, `eq.${prospect.email}`);
  assert.equal(guards["record->preview_build_consent->>status"], "eq.granted");
});

test("durable STOP and closed-lost states block before truth, provider, or persistence", async (t) => {
  for (const terminal of ["do_not_contact", "closed_lost"]) {
    await t.test(terminal, async () => {
      let truthCalls = 0;
      let mirrorCalls = 0;
      let writes = 0;
      const prospect = {
        prospect_id: `terminal-build-${terminal}`,
        business_name: "Terminal Build Plumbing",
        email: "owner@terminal-build.example",
        industry: "plumbing",
        city: "Irvine",
        state: "CA",
        services: ["Drain cleaning"],
        status: terminal,
        updated_at: "2026-08-29T12:00:00.000Z",
        truth_packet_source: "intake_genie",
        truth_packet: strongTruthPacket(),
        ...(terminal === "do_not_contact" ? { do_not_contact: true } : {}),
      };
      const result = await buildPreviewForProspect(prospect, {
        source: "terminal-build-test",
        truthPacketWithLocalPlan: async () => {
          truthCalls += 1;
          throw new Error("terminal row must stop before truth");
        },
        mirrorBuildDouble: async () => {
          mirrorCalls += 1;
          throw new Error("terminal row must stop before Mirror/provider");
        },
        conditionalUpdate: async () => {
          writes += 1;
          throw new Error("terminal row must not be rewritten");
        },
        upsertRow: async () => {
          writes += 1;
          throw new Error("terminal row must not be rewritten");
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.status, terminal);
      assert.equal(result.blocked, terminal);
      assert.equal(result.persistence, "durable_terminal_state");
      assert.equal(result.lead_rejection, false);
      assert.equal(truthCalls, 0);
      assert.equal(mirrorCalls, 0);
      assert.equal(writes, 0);
    });
  }
});

test("nested durable contact enrichment STOP blocks before truth, provider, or persistence", async () => {
  let truthCalls = 0;
  let mirrorCalls = 0;
  let writes = 0;
  const prospect = {
    prospect_id: "nested-terminal-build",
    business_name: "Nested STOP Plumbing",
    email: "owner@nested-stop.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
    record: {
      contact_enrichment: {
        do_not_contact: true,
        outreach: { status: "do_not_contact" },
      },
    },
  };
  const result = await buildPreviewForProspect(prospect, {
    source: "nested-terminal-build-test",
    truthPacketWithLocalPlan: async () => { truthCalls += 1; },
    mirrorBuildDouble: async () => { mirrorCalls += 1; },
    conditionalUpdate: async () => { writes += 1; },
    upsertRow: async () => { writes += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "new");
  assert.equal(result.blocked, "do_not_contact");
  assert.equal(result.persistence, "durable_terminal_state");
  assert.equal(truthCalls, 0);
  assert.equal(mirrorCalls, 0);
  assert.equal(writes, 0);
});

test("a soft outreach review hold does not block an ordinary unverified lead from Mirror", async () => {
  let mirrorCalls = 0;
  const prospect = {
    prospect_id: "soft-review-hold-build",
    business_name: "Soft Review Plumbing",
    email: "owner@soft-review.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
    record: {
      contact_enrichment: {
        outreach: {
          review_hold: true,
          hold_reasons: ["email_reachability_unverified"],
        },
      },
    },
  };

  const result = await buildPreviewForProspect(prospect, {
    persist: false,
    source: "soft-review-hold-test",
    mirrorBuildDouble: async () => {
      mirrorCalls += 1;
      return { ok: false, reason: "mirror_probe_complete" };
    },
  });

  assert.equal(mirrorCalls, 1, "a normal unverified email must still reach the build lane");
  assert.equal(result.blocked, "mirror_probe_complete");
});

test("parallel reveal polls acquire one durable claim and invoke Mirror once", async () => {
  const prospect = {
    prospect_id: "parallel-reveal-claim",
    business_name: "Parallel Reveal Plumbing",
    email: "owner@parallel-reveal.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  let state = durableConsentRow(prospect);
  let initialReads = 0;
  let releaseInitialReads;
  const initialReadBarrier = new Promise((resolve) => { releaseInitialReads = resolve; });
  const select = async () => {
    if (initialReads < 2) {
      const snapshot = structuredClone(state);
      initialReads += 1;
      if (initialReads === 2) releaseInitialReads();
      await initialReadBarrier;
      return { ok: true, mode: "test_live_select", data: [snapshot] };
    }
    return { ok: true, mode: "test_live_select", data: [structuredClone(state)] };
  };
  let conditionalWrites = 0;
  const conditionalUpdate = async (_table, _idColumn, id, guards, patch) => {
    const versionMatches = guards.updated_at === `eq.${state.updated_at}`;
    const statusMatches = guards.status === `eq.${state.status}`;
    if (!versionMatches || !statusMatches) {
      return { mode: "live_update", updated: false, rows: [] };
    }
    conditionalWrites += 1;
    state = { ...state, prospect_id: id, ...structuredClone(patch) };
    return { mode: "live_update", updated: true, rows: [structuredClone(state)] };
  };
  let mirrorCalls = 0;
  const buildMirrorForProspect = async () => {
    mirrorCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return passingMirrorBuild();
  };
  const options = {
    source: "reveal_click",
    select,
    conditionalUpdate,
    buildMirrorForProspect,
    upsertRow: async () => {
      throw new Error("claimed reveal finalization must use CAS");
    },
    now: () => Date.parse("2026-08-29T12:01:00.000Z"),
  };

  const [left, right] = await Promise.all([
    buildPreviewForProspectCore(structuredClone(prospect), options),
    buildPreviewForProspectCore(structuredClone(prospect), options),
  ]);
  const results = [left, right];
  const winner = results.find((result) => result.ok === true);
  const loser = results.find((result) => result.blocked === "mirror_build_claim_unproven");

  assert.ok(winner, "one claimant completes the exact build");
  assert.ok(loser, "the losing poll exits before Mirror");
  assert.equal(winner.status, "previewed");
  assert.equal(mirrorCalls, 1);
  assert.equal(conditionalWrites, 2, "one claim plus the winner's exact final CAS");
  assert.equal(state.status, "previewed");
  assert.equal(state.record.mirror_build_claim, undefined, "final persistence clears the lease");
});

test("a lost reveal final write stays fenced until lease expiry then resumes the exact operation", async () => {
  const prospect = {
    prospect_id: "reveal-claim-expiry",
    business_name: "Reveal Claim Expiry Plumbing",
    email: "owner@reveal-expiry.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  let state = durableConsentRow(prospect);
  let nowMs = Date.parse("2026-08-29T12:01:00.000Z");
  let failFirstFinal = true;
  const select = async () => ({ ok: true, mode: "test_live_select", data: [structuredClone(state)] });
  const conditionalUpdate = async (_table, _idColumn, id, guards, patch) => {
    if (guards.updated_at !== `eq.${state.updated_at}` || guards.status !== `eq.${state.status}`) {
      return { mode: "live_update", updated: false, rows: [] };
    }
    const isClaim = Boolean(patch.record?.mirror_build_claim);
    if (!isClaim && failFirstFinal) {
      failFirstFinal = false;
      return { mode: "live_update_failed", updated: false, rows: [] };
    }
    state = { ...state, prospect_id: id, ...structuredClone(patch) };
    return { mode: "live_update", updated: true, rows: [structuredClone(state)] };
  };
  const operationKeys = [];
  const options = {
    source: "reveal_click",
    select,
    conditionalUpdate,
    buildMirrorForProspect: async (_prospect, buildOptions) => {
      operationKeys.push(buildOptions.operationKey);
      return passingMirrorBuild();
    },
    upsertRow: async () => { throw new Error("reveal claim path must use CAS"); },
    now: () => nowMs,
  };

  const first = await buildPreviewForProspectCore(structuredClone(prospect), options);
  const immediate = await buildPreviewForProspectCore(structuredClone(prospect), options);
  assert.equal(first.blocked, "mirror_final_persistence_unproven");
  assert.equal(immediate.blocked, "mirror_build_in_flight");
  assert.equal(operationKeys.length, 1, "the durable lease blocks immediate provider re-entry");

  nowMs += (16 * 60 * 1000);
  const recovered = await buildPreviewForProspectCore(structuredClone(prospect), options);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.status, "previewed");
  assert.equal(operationKeys.length, 2);
  assert.equal(operationKeys[0], operationKeys[1], "expired recovery resumes the original exact provider receipt");
  assert.equal(state.record.mirror_build_claim, undefined);
});

test("Mirror operation identity ignores bookkeeping writes but rotates on a real source revision", async () => {
  const keys = [];
  const base = {
    prospect_id: "operation-source-revision",
    business_name: "Source Revision Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  const options = {
    persist: false,
    source: "operation-source-revision-test",
    mirrorBuildDouble: async (input) => {
      keys.push(input.job.id);
      return { ok: false, reason: "source-fingerprint-probe" };
    },
  };

  await buildPreviewForProspect(base, options);
  await buildPreviewForProspect({
    ...base,
    status: "held",
    updated_at: "2026-08-29T12:05:00.000Z",
  }, options);
  await buildPreviewForProspect({
    ...base,
    services: ["Drain cleaning", "Water heater repair"],
  }, options);

  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1], "status/timestamp bookkeeping does not rotate the provider receipt");
  assert.notEqual(keys[1], keys[2], "a real normalized build-input revision rotates the receipt");
});

test("re-stamping the same granted consent does not rotate the Mirror operation identity", async () => {
  const keys = [];
  const base = {
    prospect_id: "operation-consent-restamp",
    business_name: "Consent Restamp Plumbing",
    email: "owner@consent-restamp.example",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  };
  const build = async (recordedAt) => {
    const durable = {
      ...structuredClone(base),
      record: {
        preview_build_consent: {
          status: "granted",
          recorded_at: recordedAt,
          source: "owner_reply",
        },
      },
    };
    return buildPreviewForProspectCore(structuredClone(durable), {
      source: "operation-consent-restamp-test",
      persist: false,
      select: async () => ({ ok: true, mode: "test_fixture", data: [structuredClone(durable)] }),
      buildMirrorForProspect: async (_prospect, buildOptions) => {
        keys.push(buildOptions.operationKey);
        return { ok: false, reason: "consent-restamp-probe" };
      },
    });
  };

  await build("2026-08-29T11:00:00.000Z");
  await build("2026-08-29T11:05:00.000Z");

  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("equivalent compiler truth with fresh job and generated timestamps keeps one operation identity", async () => {
  const keys = [];
  let compiles = 0;
  const prospect = {
    prospect_id: "volatile-compiler-metadata",
    business_name: "Volatile Metadata Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "places_basic",
    truth_packet: { meta: { source: "places_basic" } },
  };
  const options = {
    persist: false,
    source: "volatile-compiler-metadata-test",
    truthPacketWithLocalPlan: async () => {
      compiles += 1;
      const packet = strongTruthPacket();
      packet.meta = {
        ...packet.meta,
        generated_at: `2026-08-29T12:0${compiles}:00.000Z`,
        job_id: `compiler-job-${compiles}`,
      };
      packet.intakeGenie = {
        ...packet.intakeGenie,
        job_id: `canonical-compiler-job-${compiles}`,
        request_id: `canonical-compiler-request-${compiles}`,
        generated_at: `2026-08-29T12:0${compiles}:01.000Z`,
        compiled_at: `2026-08-29T12:0${compiles}:02.000Z`,
      };
      return packet;
    },
    mirrorBuildDouble: async (input) => {
      keys.push(input.job.id);
      return { ok: false, reason: "volatile-metadata-probe" };
    },
  };

  await buildPreviewForProspect(structuredClone(prospect), options);
  await buildPreviewForProspect(structuredClone(prospect), options);

  assert.equal(compiles, 2);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("a stale caller rebases onto the latest durable build source and operation identity", async () => {
  const mirrorInputs = [];
  const oldTruth = strongTruthPacket();
  oldTruth.services = ["Old drain service"];
  oldTruth.intakeGenie.facts.services = ["Old drain service"];
  oldTruth.intakeGenie.evidence[0].value = ["Old drain service"];
  oldTruth.localSearchPlan.citations = oldTruth.intakeGenie.evidence;
  const newTruth = strongTruthPacket();
  newTruth.services = ["New water heater service"];
  newTruth.intakeGenie.facts.services = ["New water heater service"];
  newTruth.intakeGenie.evidence[0].value = ["New water heater service"];
  newTruth.localSearchPlan.citations = newTruth.intakeGenie.evidence;
  const staleCaller = {
    prospect_id: "durable-source-rebase",
    business_name: "Durable Source Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    services: ["Old drain service"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: oldTruth,
    record: { source_revision: "old" },
  };
  const durableOld = durableConsentRow(staleCaller);
  const durableNew = durableConsentRow({
    ...staleCaller,
    services: ["New water heater service"],
    updated_at: "2026-08-29T12:05:00.000Z",
    truth_packet: newTruth,
    record: { source_revision: "new" },
  });
  const build = async (durableRow) => buildPreviewForProspectCore(structuredClone(staleCaller), {
    persist: false,
    source: "durable-source-rebase-test",
    select: async () => ({ ok: true, mode: "live_select", data: [structuredClone(durableRow)] }),
    buildMirrorForProspect: async (buildProspect, buildOptions) => {
      mirrorInputs.push({
        services: structuredClone(buildProspect.truth_packet.services),
        sourceRevision: buildProspect.record.source_revision,
        operationKey: buildOptions.operationKey,
      });
      return { ok: false, reason: "durable-source-rebase-probe" };
    },
  });

  await build(durableOld);
  await build(durableNew);

  assert.deepEqual(mirrorInputs[0].services, ["Old drain service"]);
  assert.deepEqual(mirrorInputs[1].services, ["New water heater service"]);
  assert.equal(mirrorInputs[1].sourceRevision, "new", "the stale request wrapper cannot erase durable source state");
  assert.notEqual(
    mirrorInputs[0].operationKey,
    mirrorInputs[1].operationKey,
    "a real durable source revision rotates the provider operation receipt",
  );
});

test("Mirror Engine exceptions preserve safe diagnostics and never call SiteForge", async () => {
  let siteForgeCalls = 0;
  const result = await buildPreviewForProspect({
    prospect_id: "mirror-exception-summary",
    business_name: "Mirror Exception Plumbing",
    industry: "plumbing",
    city: "Austin",
    state: "TX",
    services: ["Drain cleaning"],
    truth_packet_source: "intake_genie",
    truth_packet: strongTruthPacket(),
  }, {
    source: "mirror-exception-summary-test",
    persist: false,
    mirrorBuildDouble: async () => {
      throw new Error("Mirror unavailable token=must-not-leak");
    },
    dispatchSiteForgePreview: async () => {
      siteForgeCalls += 1;
      throw new Error("fresh SiteForge dispatch must remain unreachable");
    },
  });

  assert.equal(siteForgeCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, "held");
  assert.equal(result.blocked, "mirror_engine_dispatch_exception");
  assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.error_code, undefined);
  assert.equal(result.error, "Mirror unavailable token=[redacted]");
  assert.equal(result.http_status, null);
  assert.equal(result.dispatch.mode, "mirror_lane");
  assert.equal(result.dispatch.ready, false);
  assert.equal(result.dispatch.pending, false);
  assert.deepEqual(result.dispatch.blocked, ["mirror_engine_dispatch_exception"]);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.legacy_siteforge_drained, false);
  assert.equal(result.dispatch.error_code, undefined);
  assert.equal(result.dispatch.error, result.error);
  assert.equal(result.dispatch.http_status, result.http_status);
  assert.doesNotMatch(JSON.stringify(result.dispatch), /must-not-leak/);
});

test("packaged mirror dispatch stays disabled even when both legacy flags are enabled", async (t) => {
  const siteforgePath = require.resolve("../lib/siteforge");
  const mirrorBuildPath = require.resolve("../lib/mirror-build");
  const forgePath = require.resolve("../lib/forge");
  const donorRegistryPath = require.resolve("../lib/donor-registry");
  const storePath = require.resolve("../lib/store");
  const targets = [siteforgePath, mirrorBuildPath, forgePath, donorRegistryPath, storePath];
  const previousModules = new Map(targets.map((target) => [target, require.cache[target]]));
  const previousEnv = {
    SITEFORGE_MIRROR_LANE: process.env.SITEFORGE_MIRROR_LANE,
    SITEFORGE_MIRROR_RELEASE_GATED: process.env.SITEFORGE_MIRROR_RELEASE_GATED,
    GHOST_AGENCY_CHECKOUT_LINK_SECRET: process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET,
    GHOST_AGENCY_API_URL: process.env.GHOST_AGENCY_API_URL,
  };

  t.after(() => {
    for (const target of targets) {
      delete require.cache[target];
      if (previousModules.get(target)) require.cache[target] = previousModules.get(target);
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const cachedModule = (filename, exports) => ({ id: filename, filename, loaded: true, exports });
  let mirrorBuildCalls = 0;
  let vercelDeployCalls = 0;
  require.cache[mirrorBuildPath] = cachedModule(mirrorBuildPath, {
    mirrorBuild: async () => {
      mirrorBuildCalls += 1;
      return { files: [], manifest: { passed: true } };
    },
  });
  require.cache[forgePath] = cachedModule(forgePath, {
    vercelDeploy: async () => {
      vercelDeployCalls += 1;
      return { alias: "mirror-checkout-austin.wss-ai.com", url: "https://deployment.example" };
    },
  });
  require.cache[donorRegistryPath] = cachedModule(donorRegistryPath, {
    pickDonor: () => ({
      donor_id: "roofing-tekline",
      source: { path: "boilerplates/roofing-tekline" },
      donor_manifest: { name: "Tekline Roofing" },
    }),
  });
  require.cache[storePath] = cachedModule(storePath, {
    recordEvent: async () => ({ ok: true }),
  });

  process.env.SITEFORGE_MIRROR_LANE = "true";
  process.env.SITEFORGE_MIRROR_RELEASE_GATED = "true";
  process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET = "mirror-checkout-test-secret";
  process.env.GHOST_AGENCY_API_URL = "https://ghost.example";
  delete require.cache[siteforgePath];
  const { dispatchSiteForgePreview } = require(siteforgePath);

  const result = await dispatchSiteForgePreview({
    prospect: {
      prospect_id: "mirror-checkout",
      business_name: "Mirror Checkout",
      industry: "roofing",
      city: "Austin",
      state: "TX",
      email: "owner@mirror-checkout.test",
      logo_url: "https://mirror-checkout.test/logo.svg",
      brand_color: "#123456",
    },
    job: { id: "siteforge_mirror_checkout" },
    truthPacket: {},
    skipAmbiance: true,
  });

  assert.equal(result.mode, "handoff_packet");
  assert.equal(result.configured, false);
  assert.equal(result.payload.eventName, "ghost_agency_preview_requested");
  assert.match(result.payload.prospect.checkout_url, /^https:\/\/ghost\.example\/api\/checkout-link\?/);
  assert.equal(result.payload.purchase_url, result.payload.prospect.checkout_url);
  assert.equal(mirrorBuildCalls, 0);
  assert.equal(vercelDeployCalls, 0);
});

test("full-run sends an artifact-free consent offer and never uses a stale or fresh checkout", async () => {
  const sends = [];
  const staleCheckout = "https://checkout.example/stale";
  const freshCheckout = "https://checkout.example/fresh-build";
  let buildCalls = 0;
  const prospect = {
    prospect_id: "fresh-checkout-send",
    business_name: "Fresh Checkout Plumbing",
    email: "prospect@freshcheckoutplumbing.com",
    status: "new",
    updated_at: "2026-07-29T12:00:00.000Z",
    industry: "plumbing",
    city: "Austin",
    state: "TX",
    checkout_url: staleCheckout,
    record: { email: "prospect@freshcheckoutplumbing.com", checkout_url: staleCheckout },
  };

  const result = await runFullSystem({
    prospectIds: [prospect.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      ownerSandboxAddress: () => "owner@wss-ai.test",
      select: async () => ({ ok: true, data: [prospect] }),
      emailLogExists: async () => ({ exists: false }),
      buildPreviewForProspect: async () => {
        buildCalls += 1;
        throw new Error("cold full-run must never build");
      },
      packetProspectForConsent: async (selected) => ({
        ok: true,
        prospect_id: selected.prospect_id,
        business_name: selected.business_name,
        packeted: true,
        siteforge_dispatched: false,
        autosend_created: false,
        prospect: { ...selected, checkout_url: freshCheckout },
      }),
      sendSequenceStep: async (input) => {
        sends.push(input);
        return { ok: true, mode: "owner_only_proof", id: "consent-offer-mail" };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(buildCalls, 0);
  assert.equal(result.built.length, 0);
  assert.equal(sends.length, 1);
  assert.equal(Object.hasOwn(sends[0].prospect, "checkout_url"), false);
  assert.equal(Object.hasOwn(sends[0].prospect.record, "checkout_url"), false);
  assert.equal(Object.hasOwn(sends[0].vars, "checkout_url"), false);
});
