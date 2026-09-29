"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const fullRunPath = require.resolve(path.join(backendRoot, "lib", "full-run.js"));
const leadMinerPath = require.resolve(path.join(backendRoot, "lib", "lead-miner.js"));
const envCompatPath = require.resolve(path.join(backendRoot, "lib", "env-compat.js"));
const storePath = require.resolve(path.join(backendRoot, "lib", "store.js"));
const buildOnClickPath = require.resolve(path.join(backendRoot, "lib", "build-on-click.js"));

function cachedModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

function loadFullRunWithoutMining(capturedEvents = [], storeSelect = async () => ({ ok: true, data: [] })) {
  const targets = [fullRunPath, leadMinerPath, envCompatPath, storePath, buildOnClickPath];
  const previous = new Map(targets.map((target) => [target, require.cache[target]]));

  require.cache[leadMinerPath] = cachedModule(leadMinerPath, {
    mineLeads: async () => {
      throw new Error("mineLeads must not run for an explicit persisted batch");
    },
    // full-run's sendableEmailFor filters placeholder addresses out of the
    // contactable set. Every persisted fixture here is a controlled, real-
    // business stand-in (there are no scrape placeholders in these batches), so
    // the stub declares that plainly. Omitting it made isPlaceholderEmail
    // undefined and crashed runFullSystem's send selection.
    isPlaceholderEmail: () => false,
  });
  require.cache[envCompatPath] = cachedModule(envCompatPath, {
    outreachFromStatus: () => ({ ok: true }),
  });
  require.cache[storePath] = cachedModule(storePath, {
    event: async (entry) => {
      capturedEvents.push(entry);
      return { ok: true };
    },
    select: storeSelect,
    upsertRow: async () => ({ mode: "test" }),
  });
  // If this helper is consulted, persisted-batch runs must nevertheless build
  // every selected prospect rather than emitting a reveal-only item.
  require.cache[buildOnClickPath] = cachedModule(buildOnClickPath, {
    sampledBuildOnClick: () => true,
  });
  delete require.cache[fullRunPath];

  const fullRun = require(fullRunPath);
  return {
    fullRun,
    restore() {
      for (const target of targets) {
        delete require.cache[target];
        if (previous.get(target)) require.cache[target] = previous.get(target);
      }
    },
  };
}

function persistedProspect(number) {
  return {
    prospect_id: `persisted-${number}`,
    status: "new",
    updated_at: "2026-07-28T11:59:00.000Z",
    business_name: `Persisted Business ${number}`,
    email: `real-${number}@business.test`,
    owner_email: `real-${number}@business.test`,
    industry: "plumbing",
    city: "Austin",
    state: "TX",
    services: ["Drain cleaning"],
    report_url: `https://reports.wss-ai.com/persisted-${number}`,
    preview_url: `https://previews.wss-ai.com/persisted-${number}`,
    record: {
      email: `real-${number}@business.test`,
      preview_url: `https://previews.wss-ai.com/persisted-${number}`,
      build_dispatch: { job_id: `old-build-${number}`, pending: true },
    },
  };
}

function passingPacket(prospect) {
  return {
    ok: true,
    prospect_id: prospect.prospect_id,
    business_name: prospect.business_name,
    status: "packeted",
    packeted: true,
    siteforge_dispatched: false,
    autosend_created: false,
    prospect,
  };
}

test("explicit persisted five keeps requested order, packets all five, and performs zero cold builds", async (t) => {
  const capturedEvents = [];
  const { fullRun, restore } = loadFullRunWithoutMining(capturedEvents);
  t.after(restore);

  const rows = [persistedProspect(1), persistedProspect(2), persistedProspect(3), persistedProspect(4), persistedProspect(5), persistedProspect(6)];
  const requested = ["persisted-5", "persisted-2", "persisted-4", "persisted-1", "persisted-3"];
  const selected = [];
  const packets = [];
  let builds = 0;
  const sends = [];
  const originalDateNow = Date.now;
  const startedAt = Date.parse("2026-07-28T12:00:00.000Z");
  let fakeNow = startedAt;
  Date.now = () => fakeNow;
  t.after(() => {
    Date.now = originalDateNow;
  });

  const result = await fullRun.runFullSystem({
    runId: "ui_owner_five_test",
    prospectIds: requested,
    count: 5,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async (table) => {
        assert.equal(table, "ghost_agency_prospects");
        selected.push(table);
        return { ok: true, data: rows };
      },
      buildPreviewForProspect: async () => {
        builds += 1;
        throw new Error("cold persisted batch must not build");
      },
      packetProspectForConsent: async (prospect, options) => {
        packets.push({ prospect, options });
        fakeNow = startedAt + 226_000;
        return passingPacket(prospect);
      },
      sendSequenceStep: async (input) => {
        sends.push(input);
        fakeNow += 6_500;
        return { ok: true, mode: "owner_proof", id: `mail-${input.prospect.prospect_id}` };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
      emailLogExists: async () => ({ exists: false }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(selected.length, 11, "one batch read plus two provider-boundary reads per recipient");
  assert.deepEqual(result.packeted.map((item) => item.prospect_id), requested);
  assert.deepEqual(packets.map(({ prospect }) => prospect.prospect_id), requested);
  assert.equal(builds, 0);
  assert.equal(result.built.length, 0);
  assert.deepEqual(packets.map(({ options }) => options.compositionSlot), [0, 1, 2, 3, 4]);
  assert.ok(packets.every(({ options }) => options.source === "full_run_consent_first"));
  assert.equal(sends.length, 5);
  assert.equal(fakeNow, startedAt + 226_000 + (5 * 6_500));
  assert.ok(sends.every(({ prospect }) => prospect.email === "owner@wss-ai.test"));
  assert.ok(sends.every(({ prospect }) => prospect.owner_email === "owner@wss-ai.test"));
  assert.ok(sends.every(({ prospect }) => prospect.record.email === "owner@wss-ai.test"));
  assert.ok(sends.every((input) => input.internalOwnerProof === true));
  assert.ok(sends.every((input) => input.allowReviewHoldBypass === true));
  assert.ok(sends.every((input) => input.allowDeliveryPauseBypass === true));
  assert.ok(sends.every((input) => input.allowContactHoldBypass === true));
  assert.ok(sends.every((input) => input.vars.consent_first === true));
  assert.ok(sends.every(({ prospect }) => !Object.hasOwn(prospect, "preview_url")));
  const startedEvent = capturedEvents.find((entry) => entry.payload?.stage === "started");
  const sentEvent = capturedEvents.find((entry) => entry.payload?.stage === "sent");
  assert.equal(startedEvent.payload.mode, "owner-five");
  assert.equal(startedEvent.payload.runId, "ui_owner_five_test");
  assert.equal(startedEvent.payload.ownerProofResend, true);
  assert.deepEqual(sentEvent.payload.sentProspectIds, requested);
});

test("packeted system.run events expose a handled intake hold without running SiteForge", async (t) => {
  const capturedEvents = [];
  const { fullRun, restore } = loadFullRunWithoutMining(capturedEvents);
  t.after(restore);
  const prospect = persistedProspect(1);

  const result = await fullRun.runFullSystem({
    prospectIds: [prospect.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [prospect] }),
      packetProspectForConsent: async () => ({
        ok: false,
        prospect_id: prospect.prospect_id,
        business_name: prospect.business_name,
        blocked: "intake_genie_needs_input",
        siteforge_dispatched: false,
        autosend_created: false,
        prospect,
      }),
      buildPreviewForProspect: async () => {
        throw new Error("SiteForge must not run from cold full-run");
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.sent.length, 0);
  const packetedEvent = capturedEvents.find((entry) =>
    entry.type === "system.run"
      && entry.payload?.stage === "packeted"
      && entry.payload?.prospectId === prospect.prospect_id,
  );
  assert.ok(packetedEvent);
  assert.equal(packetedEvent.payload.blocked, "intake_genie_needs_input");
  assert.equal(packetedEvent.payload.siteforgeDispatched, false);
  assert.equal(packetedEvent.payload.autosendCreated, false);
});

test("stale failed release evidence is stripped and does not block a consent offer", async (t) => {
  const capturedEvents = [];
  const { fullRun, restore } = loadFullRunWithoutMining(capturedEvents);
  t.after(restore);
  const prospect = persistedProspect(1);
  prospect.release_evidence = {
    map: { verified: false },
    template_family: { verified: false },
  };
  let sends = 0;
  let sentProspect;

  const result = await fullRun.runFullSystem({
    prospectIds: [prospect.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [prospect] }),
      packetProspectForConsent: async () => passingPacket(prospect),
      buildPreviewForProspect: async () => {
        throw new Error("cold consent offer must not build");
      },
      sendSequenceStep: async (input) => {
        sends += 1;
        sentProspect = input.prospect;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.queued, 1);
  assert.equal(result.sent.length, 1);
  assert.equal(sends, 1);
  assert.equal(Object.hasOwn(sentProspect, "release_evidence"), false);
  assert.equal(Object.hasOwn(sentProspect, "preview_url"), false);
  assert.deepEqual(result.skipped, []);
  const queuedEvent = capturedEvents.find((entry) => entry.payload?.stage === "queued");
  const sentEvent = capturedEvents.find((entry) => entry.payload?.stage === "sent");
  assert.equal(queuedEvent.payload.queued, 1);
  assert.equal(queuedEvent.payload.failedDeliveryGates, 0);
  assert.deepEqual(sentEvent.payload.skippedReasons, []);
});

test("stale SiteForge advisory state never reaches the consent renderer", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const prospect = persistedProspect(1);
  prospect.record.siteforge_callback = {
    release_evidence: {
      map: { verified: false, waived: true },
    },
  };
  let sends = 0;
  let sentProspect;

  const result = await fullRun.runFullSystem({
    prospectIds: [prospect.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [prospect] }),
      packetProspectForConsent: async () => passingPacket(prospect),
      buildPreviewForProspect: async () => {
        throw new Error("cold consent offer must not build");
      },
      sendSequenceStep: async (input) => {
        sends += 1;
        sentProspect = input.prospect;
        return { ok: true, id: "waived-owner-proof" };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.queued, 1);
  assert.equal(result.sent.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(sends, 1);
  assert.equal(Object.hasOwn(sentProspect.record, "siteforge_callback"), false);
});

test("a failed consent packet is held and never reaches inline send", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const prospect = persistedProspect(1);
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: [prospect.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [prospect] }),
      packetProspectForConsent: async () => ({
        ok: false,
        prospect_id: prospect.prospect_id,
        business_name: prospect.business_name,
        status: "held",
        blocked: "intake_genie_needs_input",
        siteforge_dispatched: false,
        autosend_created: false,
        prospect,
      }),
      buildPreviewForProspect: async () => {
        throw new Error("cold consent offer must not build");
      },
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.sent.length, 0);
  assert.equal(result.built.length, 0);
  assert.equal(result.packeted[0].blocked, "intake_genie_needs_input");
  assert.equal(sends, 0);
});

test("ownerProofResend is rejected outside sandbox before a durable read, build, or send", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  let reads = 0;
  let builds = 0;
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: false,
    ownerProofResend: true,
    _test: {
      select: async () => { reads += 1; return { ok: true, data: [persistedProspect(1)] }; },
      buildPreviewForProspect: async () => { builds += 1; return {}; },
      packetProspectForConsent: async () => {
        throw new Error("packet work must not start");
      },
      sendSequenceStep: async () => { sends += 1; return { ok: true }; },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_resend_requires_sandbox");
  assert.equal(reads, 0);
  assert.equal(builds, 0);
  assert.equal(sends, 0);
});

test("existing email suppression is bypassed only for the sandbox owner-proof resend", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const rows = [persistedProspect(1)];
  const normalSends = [];
  let normalBuildCalls = 0;
  const normal = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    _test: {
      select: async () => ({ ok: true, data: rows }),
      buildPreviewForProspect: async () => {
        normalBuildCalls += 1;
        throw new Error("cold consent offer must not build");
      },
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      sendSequenceStep: async (input) => { normalSends.push(input); return { ok: true }; },
      ownerSandboxAddress: () => "owner@wss-ai.test",
      emailLogExists: async () => ({ exists: true, reason: "email_log_prospect" }),
    },
  });
  assert.equal(normalSends.length, 0);
  assert.equal(normalBuildCalls, 0);
  assert.equal(normal.built.length, 0);
  assert.deepEqual(normal.skipped, [{ prospect_id: "persisted-1", skipped: "email_log_prospect" }]);

  const proofSends = [];
  let proofBuildCalls = 0;
  const proof = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: rows }),
      buildPreviewForProspect: async () => {
        proofBuildCalls += 1;
        throw new Error("owner-only consent proof must not build");
      },
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      sendSequenceStep: async (input) => { proofSends.push(input); return { ok: true, id: "owner-proof-1" }; },
      ownerSandboxAddress: () => "owner@wss-ai.test",
      emailLogExists: async () => ({ exists: true, reason: "email_log_prospect" }),
    },
  });
  assert.equal(proof.skipped.length, 0);
  assert.equal(proofBuildCalls, 0);
  assert.equal(proof.built.length, 0);
  assert.equal(proofSends.length, 1);
  assert.equal(proofSends[0].prospect.email, "owner@wss-ai.test");
  assert.equal(proofSends[0].vars.consent_first, true);
  assert.ok(proofSends[0].deadlineAt > 0);
});

test("a concurrent closed_lost update during de-dup wins at the final provider boundary", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const canonical = persistedProspect(1);
  let sends = 0;
  let deDupReads = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: [canonical.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [canonical] }),
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      emailLogExists: async () => {
        deDupReads += 1;
        canonical.status = "closed_lost";
        canonical.updated_at = "2026-07-28T12:01:00.000Z";
        canonical.record = {
          ...canonical.record,
          status: "closed_lost",
          do_not_contact: true,
        };
        return { exists: false };
      },
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(deDupReads, 1);
  assert.equal(sends, 0);
  assert.equal(result.sent.length, 0);
  assert.deepEqual(result.skipped, [{
    prospect_id: canonical.prospect_id,
    skipped: "closed_lost",
  }]);
});

test("sandbox owner proof never bypasses a canonical suppression lookup", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const canonical = persistedProspect(1);
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: [canonical.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [canonical] }),
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      emailLogExists: async () => ({ exists: true, reason: "suppressed" }),
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(sends, 0);
  assert.equal(result.sent.length, 0);
  assert.deepEqual(result.skipped, [{
    prospect_id: canonical.prospect_id,
    skipped: "suppressed",
  }]);
});

test("a prospect-id-only suppression outranks prior send history during owner-proof replay", async (t) => {
  const canonical = persistedProspect(1);
  const tables = [];
  const suppressionQueries = [];
  const { fullRun, restore } = loadFullRunWithoutMining([], async (table, query = "") => {
    tables.push(table);
    if (table === "ghost_agency_prospects") return { ok: true, data: [canonical] };
    if (table === "ghost_agency_suppressions") {
      suppressionQueries.push(query);
      const matchedByProspectId = query.includes(`prospect_id.eq.${canonical.prospect_id}`);
      return {
        ok: true,
        data: matchedByProspectId ? [{
          suppression_key: canonical.prospect_id,
          email: null,
          prospect_id: canonical.prospect_id,
        }] : [],
      };
    }
    if (table === "ghost_agency_email_log") {
      return {
        ok: true,
        data: [{ prospect_id: canonical.prospect_id, sequence: 1, step: 1, suppressed: false }],
      };
    }
    return { ok: true, data: [] };
  });
  t.after(restore);
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: [canonical.prospect_id],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(sends, 0);
  assert.equal(result.sent.length, 0);
  assert.deepEqual(result.skipped, [{
    prospect_id: canonical.prospect_id,
    skipped: "suppressed",
  }]);
  assert.ok(tables.includes("ghost_agency_suppressions"));
  assert.match(suppressionQueries[0], /or=\(email\.eq\..+,prospect_id\.eq\.persisted-1\)/);
  assert.equal(tables.includes("ghost_agency_email_log"), false,
    "historic send history must not short-circuit newer suppression truth");
});

test("owner proof stops before email lookup or provider work once the request deadline is spent", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const originalDateNow = Date.now;
  let fakeNow = Date.parse("2026-07-28T12:00:00.000Z");
  Date.now = () => fakeNow;
  t.after(() => {
    Date.now = originalDateNow;
  });
  let emailLogReads = 0;
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      select: async () => ({ ok: true, data: [persistedProspect(1)] }),
      packetProspectForConsent: async (prospect) => {
        fakeNow += 286_000;
        return passingPacket(prospect);
      },
      buildPreviewForProspect: async () => {
        throw new Error("owner-only consent proof must not build");
      },
      emailLogExists: async () => {
        emailLogReads += 1;
        return { exists: false };
      },
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(emailLogReads, 0);
  assert.equal(sends, 0);
  assert.deepEqual(result.skipped, [{
    prospect_id: "persisted-1",
    skipped: "owner_proof_deadline_exhausted",
  }]);
});

test("owner-only consent proof honors the route absolute send deadline without SiteForge", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const originalDateNow = Date.now;
  Date.now = () => 100_000;
  t.after(() => {
    Date.now = originalDateNow;
  });
  let buildCalls = 0;
  let sendInput;
  let emailLogReads = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    ownerProofDeadlineAt: 200_000,
    _test: {
      select: async () => ({ ok: true, data: [persistedProspect(1)] }),
      progress: async () => {},
      packetProspectForConsent: async (prospect) => passingPacket(prospect),
      buildPreviewForProspect: async () => {
        buildCalls += 1;
        throw new Error("owner-only consent proof must not build");
      },
      emailLogExists: async () => {
        emailLogReads += 1;
        return { exists: false };
      },
      sendSequenceStep: async (input) => {
        sendInput = input;
        return { ok: true, id: "owner-proof-deadline" };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.sent.length, 1);
  assert.equal(buildCalls, 0);
  assert.equal(result.built.length, 0);
  assert.equal(sendInput.deadlineAt, 200_000);
  assert.equal(sendInput.persistCampaignLog, false);
  assert.equal(sendInput.vars.consent_first, true);
  assert.equal(emailLogReads, 1, "owner proof still checks suppression and duplicate truth");
});

test("an already-expired route deadline blocks owner proof before its first durable read", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const originalDateNow = Date.now;
  Date.now = () => 100_000;
  t.after(() => {
    Date.now = originalDateNow;
  });
  let reads = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    ownerProofDeadlineAt: 99_999,
    _test: {
      select: async () => {
        reads += 1;
        return { ok: true, data: [] };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.equal(reads, 0);
});

test("owner build cutoff expiring during the durable read stops before progress or build side effects", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const originalDateNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalDateNow;
  });
  const progressStages = [];
  let builds = 0;
  let sends = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    ownerProofDeadlineAt: 200_000,
    _test: {
      progress: async (_runId, stage) => {
        progressStages.push(stage);
      },
      select: async () => {
        now = 155_001;
        return { ok: true, data: [persistedProspect(1)] };
      },
      buildPreviewForProspect: async () => {
        builds += 1;
        return {};
      },
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.deepEqual(progressStages, ["started"]);
  assert.equal(builds, 0);
  assert.equal(sends, 0);
});

test("owner build cutoff is rechecked after started progress and before durable select", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const originalDateNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalDateNow;
  });
  let reads = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ["persisted-1"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    ownerProofDeadlineAt: 200_000,
    _test: {
      progress: async (_runId, stage) => {
        if (stage === "started") now = 155_001;
      },
      select: async () => {
        reads += 1;
        return { ok: true, data: [persistedProspect(1)] };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.blocked, "owner_proof_build_deadline_exhausted");
  assert.equal(reads, 0);
});

test("explicit prospect IDs reject PostgREST control characters before any durable read", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  let reads = 0;

  const result = await fullRun.runFullSystem({
    prospectIds: ['persisted-1","persisted-2'],
    count: 1,
    dryRun: false,
    _test: {
      select: async () => {
        reads += 1;
        return { ok: true, data: [] };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_ids_have_invalid_characters");
  assert.equal(reads, 0);
});

test("non-function test hooks from JSON are ignored", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const previousOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss-ai.test";
  t.after(() => {
    if (previousOwner == null) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = previousOwner;
  });

  const result = await fullRun.runFullSystem({
    prospectIds: ["invalid,id"],
    count: 1,
    dryRun: false,
    sandboxMode: true,
    _test: {
      ownerSandboxAddress: "attacker-controlled-string",
      select: "attacker-controlled-string",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "prospect_ids_have_invalid_characters");
});

test("normal live mining exact-loads its durable canonical ID and a STOP during de-dup wins", async (t) => {
  const { fullRun, restore } = loadFullRunWithoutMining();
  t.after(restore);
  const canonical = {
    ...persistedProspect(91),
    prospect_id: "canonical-mined-91",
    email: null,
    owner_email: "MixedCase@CanonicalBusiness.COM",
    record: {
      ...persistedProspect(91).record,
      owner_email: "MixedCase@CanonicalBusiness.COM",
    },
  };
  let packets = 0;
  let sends = 0;
  let exactReads = 0;

  const result = await fullRun.runFullSystem({
    industry: "plumbing",
    location: "Austin, TX",
    count: 1,
    dryRun: false,
    sandboxMode: true,
    ownerProofResend: true,
    _test: {
      mineLeads: async () => ({
        ok: true,
        mode: "live",
        persisted: true,
        found: 1,
        withEmail: 1,
        records: [{ prospect_id: "incoming-place-id", email: "stale@incoming.example" }],
        rows: [{
          prospect_id: canonical.prospect_id,
          selected: true,
          persistence: "created",
        }],
      }),
      select: async (table) => {
        assert.equal(table, "ghost_agency_prospects");
        exactReads += 1;
        return { ok: true, data: [{ ...canonical, record: { ...canonical.record } }] };
      },
      packetProspectForConsent: async (prospect, options) => {
        packets += 1;
        assert.equal(prospect.prospect_id, canonical.prospect_id);
        assert.equal(prospect.owner_email, "MixedCase@CanonicalBusiness.COM");
        assert.equal(options.requireCanonicalGuard, true);
        return passingPacket(prospect);
      },
      emailLogExists: async () => {
        canonical.status = "do_not_contact";
        canonical.updated_at = "2026-07-28T12:01:00.000Z";
        canonical.record = { ...canonical.record, status: "do_not_contact", do_not_contact: true };
        return { exists: false };
      },
      sendSequenceStep: async () => {
        sends += 1;
        return { ok: true, mode: "sent" };
      },
      ownerSandboxAddress: () => "owner@wss-ai.test",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(packets, 1);
  assert.equal(sends, 0);
  assert.ok(exactReads >= 3, "normal live path did not re-read canonical state through the send boundary");
  assert.equal(result.sent.length, 0);
});

test("normal live mining fails closed when persistence is unproven or held for identity review", async (t) => {
  for (const [name, persisted, persistence] of [
    ["unproven", false, "created"],
    ["identity review", true, "duplicate_conflict_review_hold"],
  ]) {
    const { fullRun, restore } = loadFullRunWithoutMining();
    t.after(restore);
    let packetCalls = 0;
    let sendCalls = 0;
    let reads = 0;
    const result = await fullRun.runFullSystem({
      industry: "plumbing",
      location: "Austin, TX",
      count: 1,
      dryRun: false,
      sandboxMode: true,
      ownerProofResend: true,
      _test: {
        mineLeads: async () => ({
          ok: true,
          mode: "live",
          persisted,
          records: [persistedProspect(92)],
          rows: [{ prospect_id: "canonical-mined-92", selected: true, persistence }],
        }),
        select: async () => { reads += 1; return { ok: true, data: [] }; },
        packetProspectForConsent: async () => { packetCalls += 1; return {}; },
        sendSequenceStep: async () => { sendCalls += 1; return {}; },
        ownerSandboxAddress: () => "owner@wss-ai.test",
      },
    });
    assert.equal(result.ok, false, name);
    assert.equal(result.blocked, "canonical_mining_persistence_unproven", name);
    assert.equal(reads, 0, name);
    assert.equal(packetCalls, 0, name);
    assert.equal(sendCalls, 0, name);
  }
});
