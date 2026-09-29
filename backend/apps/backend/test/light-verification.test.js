"use strict";

// test/light-verification.test.js — GHOST_AGENCY_LIGHT_VERIFICATION.
//
// OWNER DIRECTIVE, 2026-09-01: the post-build browser verification is "too
// heavy — another chef in the kitchen." The factory TRUSTS the build and
// ships. This file pins the switch that kills the heavy browser policing —
// and the safety that STAYS on in both modes:
//
//   · request schema validation and the engine's truth checks still run,
//   · identity_scan (donor-leak string matching, no browser) still runs,
//   · the content floor's channel accounting still refuses an empty row,
//   · the build marks itself verification:"light" | "full" for later audit.
//
// CI pins the EXISTING suite to "0" (full); these tests flip the env per test
// so both modes are proven in one file.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// GATE 4C: fixture clients must never be stamped into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-light-"));

const ENV_NAME = "GHOST_AGENCY_LIGHT_VERIFICATION";
const { lightVerificationEnabled, verificationMode } = require("../lib/light-verification");

function withEnv(value, fn) {
  const saved = process.env[ENV_NAME];
  if (value === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (saved === undefined) delete process.env[ENV_NAME];
      else process.env[ENV_NAME] = saved;
    });
}

// ---------------------------------------------------------------------------
// The switch itself
// ---------------------------------------------------------------------------

test("the switch defaults LIGHT ON; only the exact string \"0\" restores full", async () => {
  await withEnv(undefined, async () => {
    assert.equal(lightVerificationEnabled({}), true, "unset env means light per the owner directive");
    assert.equal(verificationMode({}), "light");
  });
  assert.equal(lightVerificationEnabled({ [ENV_NAME]: "1" }), true);
  assert.equal(lightVerificationEnabled({ [ENV_NAME]: "0" }), false);
  assert.equal(verificationMode({ [ENV_NAME]: "0" }), "full");
  // A partial env object is an OVERRIDE, not a replacement: the factory-level
  // process env still decides unless the caller actually defines the key.
  assert.equal(verificationMode({ GHOST_AGENCY_HERO_AUTOLINE: "0" }), verificationMode(process.env));
});

// ---------------------------------------------------------------------------
// The engine: light mode never opens the render/audit browsers
// ---------------------------------------------------------------------------

const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { chooseBrandMark } = require("../lib/mirror-engine/logo-ladder");
const { slugPolicy } = require("../lib/mirror-engine/deploy");

function lightRequest() {
  return {
    slug: "wss-test-light-verification-roofing",
    donor: "mirror-donor",
    facts: {
      business_name: "Light Verification Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0175",
    },
    content: { services: [{ name: "Roof repair" }] },
    brand: {
      mark: chooseBrandMark({
        logoCandidates: [],
        businessName: "Light Verification Roofing",
        accent: "#c8102e",
      }),
      site_accent: "#c8102e",
      site_accent_source: "https://light-verification.example.com/",
    },
  };
}

/** Deploy stubs whose renderCheck/renderAudit mocks count their own calls. */
function makeEngineDeps() {
  const calls = [];
  return {
    calls,
    deps: {
      slugPolicy,
      withSpaRewrite: (files) => files["vercel.json"] ? files : { ...files, "vercel.json": Buffer.from('{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}') },
      ensureProject: async () => "prj_stub_light",
      resolveAliasDeployment: async () => ({ found: false, reason: "alias_not_found" }),
      uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 3, deduped: 0 }),
      createDeployment: async () => ({ id: "dpl_stub_light", url: "stub-light.vercel.app", readyState: "QUEUED" }),
      waitReady: async () => ({ readyState: "READY" }),
      byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
      deepLinkCheck: async () => ({ clean: true, failures: [] }),
      attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
      aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
      // THE MOCKS UNDER TEST. If light mode is on, neither may be invoked.
      renderCheck: async () => { calls.push(["renderCheck"]); return { status: "passed", problems: [] }; },
      renderAudit: async () => { calls.push(["renderAudit"]); return { status: "passed", problems: [], pages: [] }; },
    },
  };
}

test("LIGHT engine build: renderCheck and renderAudit mocks are never invoked", async () => {
  await withEnv("1", async () => {
    const { deps, calls } = makeEngineDeps();
    const res = await mirror(lightRequest(), { registry: createRegistry(), deps });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
    assert.deepEqual(calls, [], "no browser render or render-audit pass may run in light mode");
    assert.equal(res.body.verification, "light");
    assert.equal(res.body.checks.render.status, "skipped_light_verification");
    assert.equal(res.body.checks.route_render.status, "skipped_light_verification");
  });
});

test("LIGHT engine build still runs the kept checks and can be revealable", async () => {
  await withEnv("1", async () => {
    const { deps } = makeEngineDeps();
    const res = await mirror(lightRequest(), { registry: createRegistry(), deps });
    // KEPT, cheap, no browser: schema validation happened (a 200 means the
    // request passed it), the string-matching donor-leak scan ran, and the
    // byte-level truth checks still decide revealable.
    assert.equal(res.body.checks.identity_scan.status, "passed");
    assert.equal(res.body.checks.token_scan.status, "passed");
    assert.equal(res.body.checks.hydration_parse.status, "passed");
    assert.equal(res.body.checks.sameness.status, "passed");
    assert.equal(res.body.revealable, true, "a truthful light build ships — that is the directive");
    assert.equal(res.body.checks.critical_visual.status, "passed",
      "critical_visual judges the byte-level hero/logo facts; the skipped render must not fail it");
  });
});

test("FULL engine build (env 0) is unchanged: both browser passes run and are recorded", async () => {
  await withEnv("0", async () => {
    const { deps, calls } = makeEngineDeps();
    const res = await mirror(lightRequest(), { registry: createRegistry(), deps });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.map(([name]) => name).sort(), ["renderAudit", "renderCheck"]);
    assert.equal(res.body.verification, "full");
    assert.equal(res.body.checks.render.status, "passed");
    assert.equal(res.body.checks.route_render.status, "passed");
    assert.equal(res.body.revealable, true);
  });
});

test("a donor leak still refuses a LIGHT build — identity_scan is not browser work", async () => {
  await withEnv("1", async () => {
    const { deps } = makeEngineDeps();
    const leaky = await mirror({ ...lightRequest(), donor: "mirror-donor-leaky" }, { registry: createRegistry(), deps });
    // A leaky donor is refused by the string-matching scan before any render
    // pass would ever have run — the kept safety, proven in light mode.
    assert.notEqual(leaky.status, 200);
    assert.equal(leaky.body.error, "donor_identity_detected");
  });
});

// ---------------------------------------------------------------------------
// The content floor: light mode skips the pixel proof, never the accounting
// ---------------------------------------------------------------------------

const { contentFloorReport: floorReport } = require("../lib/mirror-lane-build");

const NATIVE_CLAIM_NO_PROOF = {
  checks: {
    content: {
      status: "none",
      sections: 0,
      data_island: true,
      donor_consumes_content: true,
      donor_renders: ["services"],
    },
    // No route_render evidence at all — exactly what a light build produces.
  },
};

test("LIGHT floor: a claimed donor-native channel passes WITHOUT the pixel proof, and says so", () => {
  const out = floorReport(
    { services: [{ name: "Drain cleaning" }] },
    NATIVE_CLAIM_NO_PROOF,
    {},
    { verification: "light" },
  );
  assert.equal(out.status, "passed");
  assert.equal(out.verdict, "met");
  assert.equal(out.render_mode, "donor_native");
  assert.deepEqual(out.native_channels, ["services"]);
  assert.equal(out.native_proof, "skipped_light_verification");
  assert.match(out.diagnostic, /native:services\+?@light_unverified|^native:services@light_unverified/);
});

test("FULL floor on the same evidence still refuses — the proof is not faked, only skipped", () => {
  const out = floorReport(
    { services: [{ name: "Drain cleaning" }] },
    NATIVE_CLAIM_NO_PROOF,
    {},
    { verification: "full" },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.deepEqual(out.native_channels_unproven, ["services"]);
});

test("LIGHT floor still refuses a row with NO verified content — never ship an empty donor shell", async () => {
  await withEnv("1", async () => {
    // Default (no options) call sites in light env: the switch is threaded by
    // the build paths, and the no-verification default stays the full law for
    // direct callers. The refusing verdicts are mode-independent anyway:
    const empty = floorReport({}, { checks: { content: { status: "injected", sections: 2 } } }, {}, { verification: "light" });
    assert.equal(empty.status, "failed");
    assert.equal(empty.verdict, "no_verified_content");

    const notInjected = floorReport(
      { services: [{ name: "Drain cleaning" }] },
      { checks: {} },
      {},
      { verification: "light" },
    );
    assert.equal(notInjected.status, "failed");
    assert.equal(notInjected.verdict, "not_injected");

    const lost = floorReport(
      { services: [{ name: "Drain cleaning" }] },
      { checks: { content: { status: "none", sections: 0 } } },
      {},
      { verification: "light" },
    );
    assert.equal(lost.status, "failed");
    assert.equal(lost.verdict, "lost");
  });
});

// ---------------------------------------------------------------------------
// The Line gate phase: light mode records a skip, never opens a browser
// ---------------------------------------------------------------------------

const { processRowPhase } = require("../lib/line-runner");

function mirroredRow() {
  return {
    prospectId: "light-gate-1",
    businessName: "Light Gate Plumbing",
    status: "mirrored",
    previewUrl: "https://light-gate.wss-ai.com/",
    currentWebsite: "https://client.example/",
    buildHash: "b".repeat(64),
    history: [{ status: "picked", at: "2026-09-01T00:00:00.000Z" }, { status: "mirrored", at: "2026-09-01T00:01:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
}

test("LIGHT line gate: the gate mock is never invoked; the row passes with a recorded skip", async () => {
  await withEnv("1", async () => {
    let gateCalls = 0;
    let sourceCalls = 0;
    let captureCalls = 0;
    const out = await processRowPhase(mirroredRow(), { batchId: "light-batch" }, {
      sourceFacts: async () => { sourceCalls += 1; return {}; },
      gate: async () => { gateCalls += 1; return { pass: true, failed: [], checks: [] }; },
      captureEmailAssets: async () => { captureCalls += 1; return { ok: true, shots: {}, results: [] }; },
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.row.status, "gate_passed");
    assert.equal(gateCalls, 0, "the browser render gate must not run in light mode");
    assert.equal(sourceCalls, 0, "no source-fact gathering for a gate that does not run");
    assert.equal(out.row.verification, "light");
    assert.equal(out.row.gate.verification, "light");
    assert.equal(out.row.gate.skipped, "render_gate_skipped_light_verification");
    assert.equal(out.row.gate.pass, true);
    assert.deepEqual(out.row.gate.checks, [], "the skip is recorded, never a forged 12-fact pass");
    assert.equal(Object.hasOwn(out.row, "proof_shots"), false,
      "an empty capture record is not a complete proof contract, so nothing is made durable");
  });
});

// OWNER FIX 2026-08-31: light verification skipped the proof-shot capture, and
// the classic V3 email refuses to send without proof_shots — every light row
// jammed in email_queue with "shared_proof_capture_identity_missing". The
// light gate still pays ONE basic capture pass (motion extras off); the heavy
// render-audit machinery stays skipped.

test("LIGHT line gate still shoots the email's proof — capture once, motion off, heavy work untouched", async () => {
  await withEnv("1", async () => {
    const captureArgs = [];
    const shots = {
      build_hash: "b".repeat(64),
      old_captured_url: "https://client.example/",
      old_shot_sha: "1".repeat(64),
      new_captured_url: "https://light-gate.wss-ai.com/",
      new_shot_sha: "2".repeat(64),
    };
    const out = await processRowPhase(mirroredRow(), { batchId: "light-proof" }, {
      gate: async () => { throw new Error("the render gate must not run in light mode"); },
      captureEmailAssets: async (args) => {
        captureArgs.push(args);
        return { ok: true, shots, results: [] };
      },
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.row.status, "gate_passed");
    assert.equal(captureArgs.length, 1, "exactly one basic capture pass, no retry loop");
    assert.equal(captureArgs[0].previewUrl, "https://light-gate.wss-ai.com/");
    assert.equal(captureArgs[0].currentWebsite, "https://client.example/");
    assert.equal(captureArgs[0].buildHash, "b".repeat(64));
    assert.equal(captureArgs[0].motion, false, "the motion-loop extra stays off in light mode");
    assert.equal(Object.hasOwn(captureArgs[0], "browser"), false,
      "no gate browser exists in light mode; the capture brings its own chromium");
    assert.deepEqual(out.row.proof_shots, shots, "the row carries the canonical proof record");
    assert.equal(out.row.captured.ok, true, "the full capture rides the row like the full gate's hook");
    assert.equal(out.row.verification, "light");
    assert.equal(out.row.gate.skipped, "render_gate_skipped_light_verification");

    // THE EMAIL STAGE ACCEPTS IT. assetsAreCurrent is the send path's own
    // freshness law (lib/line-email-assets.js); a light row's proof must read
    // as current evidence for THIS build, no second browser.
    const { assetsAreCurrent } = require("../lib/line-email-assets");
    const verdict = assetsAreCurrent({
      shots: out.row.proof_shots,
      buildHash: "b".repeat(64),
      currentWebsite: "https://client.example/",
    });
    assert.equal(verdict.ok, true, verdict.reason);
  });
});

test("LIGHT line gate forwards the shared proof identity to the capture", async () => {
  await withEnv("1", async () => {
    const captureArgs = [];
    const proofIdentity = {
      site_id: "5b1f8a2e-0000-4c1e-9d2a-1a2b3c4d5e6f",
      release_id: "8c2a9b3f-1111-4d2f-8e3b-2b3c4d5e6f70",
      build_hash: "b".repeat(64),
    };
    const out = await processRowPhase(
      { ...mirroredRow(), proofIdentity },
      { batchId: "light-shared-proof" },
      {
        gate: async () => { throw new Error("the render gate must not run in light mode"); },
        captureEmailAssets: async (args) => {
          captureArgs.push(args);
          return {
            ok: true,
            shots: { ...proofIdentity, old_captured_url: "https://client.example/", old_shot_sha: "1".repeat(64), new_captured_url: "https://light-gate.wss-ai.com/", new_shot_sha: "2".repeat(64) },
            results: [],
          };
        },
        queueEmail: async () => ({ ok: true }),
        now: () => "2026-09-01T00:02:00.000Z",
        env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
      },
    );
    assert.equal(out.row.status, "gate_passed");
    assert.equal(captureArgs.length, 1);
    assert.deepEqual(captureArgs[0].proofIdentity, proofIdentity,
      "shared releases capture under their exact site/release/build identity");
    assert.equal(out.row.proof_shots.site_id, proofIdentity.site_id);
  });
});

test("LIGHT line gate: a failed or thrown capture never blocks the light verdict", async () => {
  await withEnv("1", async () => {
    const failing = await processRowPhase(mirroredRow(), { batchId: "light-capture-fail" }, {
      gate: async () => { throw new Error("the render gate must not run in light mode"); },
      captureEmailAssets: async () => ({ ok: false, reason: "capture_failed: boom", shots: {}, results: [] }),
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(failing.ok, true);
    assert.equal(failing.row.status, "gate_passed", "a failed capture changes nothing about the verdict");
    assert.equal(Object.hasOwn(failing.row, "proof_shots"), false, "partial proof is never made durable");
    assert.equal(Object.hasOwn(failing.row, "captured"), false);

    const throwing = await processRowPhase(mirroredRow(), { batchId: "light-capture-throw" }, {
      gate: async () => { throw new Error("the render gate must not run in light mode"); },
      captureEmailAssets: async () => { throw new Error("chromium exploded"); },
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(throwing.ok, true);
    assert.equal(throwing.row.status, "gate_passed", "a thrown capture is recorded, never fatal");
    assert.equal(Object.hasOwn(throwing.row, "proof_shots"), false);
    assert.equal(Object.hasOwn(throwing.row, "captured"), false);
  });
});

test("FULL line gate (env 0): the gate mock runs exactly once and stamps full", async () => {
  await withEnv("0", async () => {
    let gateCalls = 0;
    const out = await processRowPhase(mirroredRow(), { batchId: "full-batch" }, {
      sourceFacts: async () => ({}),
      gate: async () => { gateCalls += 1; return { pass: true, failed: [], checks: [] }; },
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(out.ok, true);
    assert.equal(out.row.status, "gate_passed");
    assert.equal(gateCalls, 1);
    assert.equal(out.row.verification, "full");
    assert.equal(out.row.gate.skipped, undefined);
  });
});

test("LIGHT line gate still refuses a row whose stored logo sha collides with another client", async () => {
  await withEnv("1", async () => {
    const sha = "c".repeat(64);
    const row = { ...mirroredRow(), logoSha256: sha };
    const seen = new Map([[sha, "another-prospect"]]);
    let captureCalls = 0;
    const out = await processRowPhase(row, { batchId: "light-collide", seenLogoShas: seen }, {
      gate: async () => { throw new Error("gate must not run"); },
      captureEmailAssets: async () => { captureCalls += 1; return { ok: true, shots: {}, results: [] }; },
      queueEmail: async () => ({ ok: true }),
      now: () => "2026-09-01T00:02:00.000Z",
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    });
    assert.equal(out.row.status, "gate_failed");
    assert.match(out.row.reason, /already shipped for another-prospect/);
    assert.equal(captureCalls, 0, "a refused row never pays for a capture");
  });
});

// ---------------------------------------------------------------------------
// The resumed stored-request path stamps the mode too
// ---------------------------------------------------------------------------

test("nativeLineBuildResult stamps verification and applies the light floor rule", async () => {
  const { nativeLineBuildResult } = require("../lib/line-mirror-resume");
  await withEnv("1", async () => {
    const request = {
      slug: "wss-test-light-resume",
      donor: "mirror-donor",
      facts: { business_name: "Light Resume Roofing", industry: "roofing" },
      brand: {},
      content: { services: [{ name: "Roof repair" }] },
    };
    const response = {
      status: 200,
      body: {
        ok: true,
        revealable: true,
        preview_url: "https://wss-test-light-resume.wss-ai.com/",
        build_hash: "d".repeat(64),
        checks: {
          content: { status: "none", sections: 0, data_island: true, donor_consumes_content: true, donor_renders: ["services"] },
        },
      },
    };
    const light = nativeLineBuildResult(request, response, null);
    assert.equal(light.verification, "light");
    assert.equal(light.revealable, true, "claimed native channel, proof skipped, substance present");
    assert.equal(light.content_floor.native_proof, "skipped_light_verification");
  });
  await withEnv("0", async () => {
    const request = {
      slug: "wss-test-full-resume",
      donor: "mirror-donor",
      facts: { business_name: "Full Resume Roofing", industry: "roofing" },
      brand: {},
      content: { services: [{ name: "Roof repair" }] },
    };
    const response = {
      status: 200,
      body: {
        ok: true,
        revealable: true,
        preview_url: "https://wss-test-full-resume.wss-ai.com/",
        build_hash: "e".repeat(64),
        checks: {
          content: { status: "none", sections: 0, data_island: true, donor_consumes_content: true, donor_renders: ["services"] },
        },
      },
    };
    const full = nativeLineBuildResult(request, response, null);
    assert.equal(full.verification, "full");
    assert.equal(full.revealable, false, "the unproven native channel still refuses under full");
    assert.equal(full.content_floor.verdict, "lost");
  });
});
