"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  OWNER_EMAIL,
  SEND_CONFIRMATION,
  assertExactlyFiveIds,
  assertOwnerOnlyEnvelope,
  ownerProofRecipients,
  parseCliArgs,
  runOwnerFiveSmoke,
} = require("../scripts/supervised-five-owner-smoke");

function prospects(count = 5) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      prospect_id: `persisted-lead-${number}`,
      status: "new",
      business_name: `Persisted Business ${number}`,
      email: `prospect-${number}@real-business.test`,
      owner_email: `prospect-${number}@real-business.test`,
      place_id: `places-${number}`,
      source: "places-live-mine",
      industry: "landscaping",
      city: "Irvine",
      services: ["Landscape design"],
      truth_packet_source: "places_basic",
      truth_packet: { meta: { source: "places_basic" } },
      record: {
        business_name: `Persisted Business ${number}`,
        email: `prospect-${number}@real-business.test`,
        owner_email: `prospect-${number}@real-business.test`,
        place_id: `places-${number}`,
        source: "places-live-mine",
      },
    };
  });
}

function passingBuild(prospect) {
  return {
    ok: true,
    prospect_id: prospect.prospect_id,
    business_name: prospect.business_name,
    status: "previewed",
    preview_url: `https://previews.wss-ai.com/${prospect.prospect_id}`,
    report_url: `https://reports.wss-ai.com/${prospect.prospect_id}`,
    checkout_url: "",
    renderer: "05-build-v8",
    generation_fingerprint: `composition-${prospect.prospect_id}-v8`,
    qc_passed: true,
    visual_qc_passed: true,
    qc_contract: "public-surface-v2",
  };
}

function successfulFetch(url) {
  return Promise.resolve({
    ok: true,
    status: 200,
    url,
    headers: { get: () => "text/html; charset=utf-8" },
    body: { cancel: async () => {} },
  });
}

async function tempOutput(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "owner-five-smoke-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function fakeDependencies(rows, calls, overrides = {}) {
  return {
    selectRows: async (table) => {
      assert.equal(table, "ghost_agency_prospects");
      return { mode: "live_select", rows };
    },
    select: async () => {
      throw new Error("Explicit prospect lookup was not expected in this test.");
    },
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospect, options });
      return passingBuild(prospect);
    },
    fetch: async (url) => {
      calls.fetch.push(url);
      return successfulFetch(url);
    },
    sendSequenceStep: async (input) => {
      calls.email.push(input);
      const recipients = ownerProofRecipients();
      assert.equal(process.env.GHOST_AGENCY_OUTREACH_CC, recipients.cc.join(","));
      assert.equal(process.env.GHOST_AGENCY_OWNER_EMAIL, recipients.owner);
      assert.equal(input.persistCampaignLog, false);
      return input.dryRun
        ? {
            ok: true,
            mode: "dry_run",
            cc: recipients.cc,
            htmlPreview: `<!doctype html><html><body>${input.prospect.business_name}</body></html>`,
          }
        : { ok: true, mode: "sent", id: `fake-${calls.email.length}` };
    },
    ...overrides,
  };
}

test("recipient gate accepts only the normalized owner with empty cc and bcc", () => {
  assert.deepEqual(
    assertOwnerOnlyEnvelope({ to: "  woodwardsoftware@GMAIL.com  ", cc: [], bcc: [] }),
    { to: OWNER_EMAIL, cc: [], bcc: [] },
  );
  assert.throws(
    () => assertOwnerOnlyEnvelope({ to: "prospect@example.com", cc: [], bcc: [] }),
    (error) => error.code === "recipient_gate_failed",
  );
  assert.throws(
    () => assertOwnerOnlyEnvelope({ to: OWNER_EMAIL, cc: [OWNER_EMAIL], bcc: [] }),
    (error) => error.code === "recipient_gate_failed",
  );
  assert.throws(
    () => assertOwnerOnlyEnvelope({ to: OWNER_EMAIL, cc: [], bcc: ["prospect@example.com"] }),
    (error) => error.code === "recipient_gate_failed",
  );
});

test("CLI is compose-only by default and requires exactly five IDs plus the exact send phrase", () => {
  const defaults = parseCliArgs([], {});
  assert.equal(defaults.confirmationPhrase, "");
  assert.deepEqual(defaults.prospectIds, []);

  const confirmed = parseCliArgs(["--confirm", SEND_CONFIRMATION], {});
  assert.equal(confirmed.confirmationPhrase, SEND_CONFIRMATION);

  assert.throws(
    () => parseCliArgs(["--confirm", "SEND_FIVE"], {}),
    (error) => error.code === "confirmation_phrase_invalid",
  );
  assert.throws(
    () => parseCliArgs(["--prospect-ids", "one,two,three,four"], {}),
    (error) => error.code === "exactly_five_prospect_ids_required",
  );
  assert.throws(
    () => assertExactlyFiveIds(["one", "two", "three", "four", "four"]),
    (error) => error.code === "exactly_five_prospect_ids_required",
  );
});

test("default run builds and composes exactly five without exposing a prospect recipient", async (t) => {
  const outputDir = await tempOutput(t);
  const rows = prospects();
  const originalEmails = rows.map((row) => row.email);
  const calls = { build: [], fetch: [], email: [] };
  const previousCc = process.env.GHOST_AGENCY_OUTREACH_CC;
  const previousOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OUTREACH_CC = "outside-audit@example.com";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "outside-owner@example.com";
  t.after(() => {
    if (previousCc === undefined) delete process.env.GHOST_AGENCY_OUTREACH_CC;
    else process.env.GHOST_AGENCY_OUTREACH_CC = previousCc;
    if (previousOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = previousOwner;
  });

  const result = await runOwnerFiveSmoke(
    { runId: "compose-five-test", outputDir },
    fakeDependencies(rows, calls),
  );

  assert.equal(result.mode, "compose_only");
  assert.equal(result.artifact.status, "composed");
  assert.equal(result.artifact.prospects.length, 5);
  assert.equal(result.artifact.safety.owner_send_attempted, false);
  assert.equal(result.artifact.safety.owner_sends_completed, 0);
  assert.equal(result.artifact.safety.campaign_invoked, false);
  assert.equal(result.artifact.safety.charge_invoked, false);
  assert.equal(result.artifact.safety.deploy_invoked, false);
  assert.equal(calls.build.length, 5);
  assert.equal(calls.fetch.length, 10);
  assert.equal(calls.email.length, 5);
  assert.ok(calls.email.every((call) => call.dryRun === true));
  assert.ok(calls.email.every((call) => call.allowReviewHoldBypass === true));
  assert.ok(calls.email.every((call) => call.allowDeliveryPauseBypass === true));
  assert.ok(calls.email.every((call) => call.internalOwnerProof === true));
  assert.ok(calls.email.every((call) => call.prospect.email === "outside-owner@example.com"));
  assert.ok(calls.email.every((call) => call.prospect.owner_email === "outside-owner@example.com"));
  assert.ok(calls.email.every((call) => call.prospect.record.email === "outside-owner@example.com"));
  calls.email.forEach((call, index) => {
    assert.equal(call.prospect.business_name, rows[index].business_name);
    assert.equal(call.prospect.record.business_name, rows[index].record.business_name);
  });
  assert.deepEqual(rows.map((row) => row.email), originalEmails, "source prospects must not be mutated");
  assert.equal(process.env.GHOST_AGENCY_OUTREACH_CC, "outside-audit@example.com");
  assert.equal(process.env.GHOST_AGENCY_OWNER_EMAIL, "outside-owner@example.com");

  const files = await fs.readdir(outputDir);
  assert.equal(files.filter((file) => file.endsWith(".html")).length, 5);
  const artifactText = await fs.readFile(path.join(outputDir, "artifact.json"), "utf8");
  assert.doesNotMatch(artifactText, /prospect-\d+@real-business\.test/);
});

test("a non-empty composed cc fails closed before any confirmed delivery", async (t) => {
  const outputDir = await tempOutput(t);
  const rows = prospects();
  const calls = { build: [], fetch: [], email: [] };
  const deps = fakeDependencies(rows, calls, {
    sendSequenceStep: async (input) => {
      calls.email.push(input);
      return {
        ok: true,
        mode: "dry_run",
        cc: [OWNER_EMAIL],
        htmlPreview: "<!doctype html><html><body>blocked</body></html>",
      };
    },
  });

  await assert.rejects(
    runOwnerFiveSmoke({ runId: "cc-gate-test", outputDir, confirmationPhrase: SEND_CONFIRMATION }, deps),
    (error) => error.code === "recipient_gate_failed",
  );
  assert.equal(calls.email.length, 1);
  assert.ok(calls.email.every((call) => call.dryRun === true));
  const artifact = JSON.parse(await fs.readFile(path.join(outputDir, "artifact.json"), "utf8"));
  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.safety.owner_send_attempted, false);
  assert.equal(artifact.safety.owner_sends_completed, 0);
});

test("a renderer, fingerprint, or QC failure blocks rendering and all owner delivery", async (t) => {
  const outputDir = await tempOutput(t);
  const rows = prospects();
  const calls = { build: [], fetch: [], email: [] };
  const deps = fakeDependencies(rows, calls, {
    buildPreviewForProspect: async (prospect) => {
      calls.build.push(prospect.prospect_id);
      const build = passingBuild(prospect);
      if (prospect.prospect_id === "persisted-lead-1") build.renderer = "05-build-v6";
      if (prospect.prospect_id === "persisted-lead-2") build.qc_passed = false;
      if (prospect.prospect_id === "persisted-lead-3") build.visual_qc_passed = false;
      if (prospect.prospect_id === "persisted-lead-4") build.generation_fingerprint = null;
      return build;
    },
  });

  await assert.rejects(
    runOwnerFiveSmoke({ runId: "qc-gate-test", outputDir, confirmationPhrase: SEND_CONFIRMATION }, deps),
    (error) => error.code === "siteforge_batch_gate_failed",
  );
  assert.equal(calls.build.length, 5);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.email.length, 0);
  const artifact = JSON.parse(await fs.readFile(path.join(outputDir, "artifact.json"), "utf8"));
  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.prospects.length, 5);
  assert.equal(artifact.prospects[0].build.renderer, "05-build-v6");
  assert.equal(artifact.prospects[1].build.qc_passed, false);
  assert.equal(artifact.prospects[2].build.visual_qc_passed, false);
  assert.equal(artifact.prospects[3].build.generation_fingerprint, null);
  assert.equal(artifact.safety.owner_send_attempted, false);
});

test("confirmed branch still composes all five first and sends only owner clones", async (t) => {
  const outputDir = await tempOutput(t);
  const rows = prospects();
  const calls = { build: [], fetch: [], email: [] };
  const result = await runOwnerFiveSmoke(
    { runId: "confirmed-owner-test", outputDir, confirmationPhrase: SEND_CONFIRMATION },
    fakeDependencies(rows, calls),
  );

  assert.equal(result.artifact.status, "owner_sent");
  assert.equal(result.artifact.safety.owner_sends_completed, 5);
  assert.equal(calls.email.length, 10);
  assert.deepEqual(calls.email.map((call) => call.dryRun), [true, true, true, true, true, false, false, false, false, false]);
  assert.ok(calls.email.every((call) => call.allowReviewHoldBypass === true));
  assert.ok(calls.email.every((call) => call.allowDeliveryPauseBypass === true));
  assert.ok(calls.email.every((call) => call.internalOwnerProof === true));
  assert.ok(calls.email.every((call) => call.prospect.email === OWNER_EMAIL));
  assert.ok(calls.email.every((call) => call.prospect.record.email === OWNER_EMAIL));
});
