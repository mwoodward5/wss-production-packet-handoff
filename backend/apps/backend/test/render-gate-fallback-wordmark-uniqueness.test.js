"use strict";

// D4 — fallback wordmark brand uniqueness, end to end.
//
// One evidence chain: rendered bytes -> gate sha256 -> row.logoSha256 ->
// atomic claim map -> resume seed. The engine renders exactly ONE wordmark per
// client, so a valid fallback verdict requires every rendered logo element at
// the engine path to carry a normalized 64-lowercase-hex sha, exactly one
// unique sha across them, and no owner already holding those bytes. Every test
// here consumes an ACTUAL render-gate verdict — no hand-authored sha stubs.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { evaluateRenderGate } = require("../lib/render-gate");
const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");

const shaFor = (id) => createHash("sha256").update(String(id)).digest("hex");
const WORDMARK_SHA = shaFor("engine-wordmark-bytes");

function fallbackSource(prospectId, businessName) {
  return {
    prospect_id: prospectId,
    business_name: businessName,
    vertical: "plumbing",
    phone: "512-555-0147",
    postal_city: "Buda",
    logo_sha256: undefined,
    brand_mark: {
      rung: "wordmark",
      value: { type: "wordmark", text: businessName, color: "#123456" },
      reason: "no usable image fell to wordmark",
    },
    donor_strings: ["Premier Plumbing Co", "(214) 555-9900", "premierplumbing.example"],
  };
}

function fallbackDom(source, logos) {
  const name = String(source.business_name || "Flint Plumbing");
  return {
    ok: true,
    url: `https://wss-test-${String(source.prospect_id || "p")}.wss-ai.com/`,
    status: 200,
    title: `${name} — Buda, TX`,
    innerText:
      `${name}\nServing Austin and the surrounding area\n` +
      "Call (512) 555-0147\n123 Main St, Buda, TX 78610\n" +
      "Drain cleaning, water heater replacement and sewer repair.\n" +
      "Licensed plumbing contractor.",
    hrefs: ["/services", "tel:+15125550147"],
    imgs: [],
    logos,
    jsonld: [{ "@type": "Plumber", name }],
  };
}

function verdictFor(prospectId, logos, seenLogoShas) {
  const source = fallbackSource(prospectId, "Flint Plumbing");
  return evaluateRenderGate({ dom: fallbackDom(source, logos), source, seenLogoShas });
}

function logoCheck(verdict) {
  return verdict.checks.find((c) => c.fact === "logo_own_and_unique");
}

test("multiple rendered elements with the SAME fallback sha pass, and the sha rides in evidence", () => {
  const verdict = verdictFor("flint_1", [
    { src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA },
    { src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA.toUpperCase() },
  ]);
  const logo = logoCheck(verdict);
  assert.equal(logo.pass, true, logo.reason);
  assert.deepEqual(logo.evidence, { fallback: true, rung: "wordmark", sha256: WORDMARK_SHA });
  assert.equal(verdict.pass, true, verdict.blockedBy);
});

test("two DISTINCT byte sets at the fallback path fail closed in one row", () => {
  const verdict = verdictFor("flint_1", [
    { src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA },
    { src: "/assets/brand-logo.svg", sha256: shaFor("something-else") },
  ]);
  const logo = logoCheck(verdict);
  assert.equal(logo.pass, false);
  assert.match(logo.reason, /2 distinct logo byte sets/);
  assert.equal(verdict.pass, false);
});

test("a malformed sha observation fails the fallback — validate before deduping", () => {
  const verdict = verdictFor("flint_1", [
    { src: "/assets/brand-logo.svg", sha256: "not-a-sha" },
  ]);
  const logo = logoCheck(verdict);
  assert.equal(logo.pass, false);
  assert.match(logo.reason, /unverifiable is not verified/);
  assert.equal(verdict.pass, false);
});

test("one valid sha plus one unfetchable fallback element fails — the set is judged, not the survivors", () => {
  const verdict = verdictFor("flint_1", [
    { src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA },
    { src: "/assets/brand-logo.svg" },
  ]);
  const logo = logoCheck(verdict);
  assert.equal(logo.pass, false);
  assert.match(logo.reason, /unverifiable is not verified/);
  assert.equal(verdict.pass, false);
});

test("the same fallback bytes already owned by another client fail with the owner named", () => {
  const seen = new Map([[WORDMARK_SHA, "someone-else"]]);
  const verdict = verdictFor("flint_1", [{ src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA }], seen);
  const logo = logoCheck(verdict);
  assert.equal(logo.pass, false);
  assert.match(logo.reason, /already shipped for someone-else/);
  assert.equal(logo.evidence.collidesWith, "someone-else");
  assert.equal(verdict.pass, false);
});

test("a fallback sha claimed at gate_passed still blocks a resumed sibling — the post-gate crash window", async () => {
  runner.resetBatches();
  const realDeps = {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    qualify: async () => ({ ok: true }),
    mirror: async (row) => ({ ok: true, previewUrl: `https://wss-test-${row.prospectId}.wss-ai.com/` }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    sourceFacts: async (row) => fallbackSource(row.prospectId, row.businessName),
    gate: async ({ source, seenLogoShas }) => evaluateRenderGate({
      dom: fallbackDom(source, [{ src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA }]),
      source,
      seenLogoShas,
    }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    onProgress: () => {},
    snapshot: () => {},
    haltCheck: async () => ({ halt: false, reason: "" }),
    concurrency: 1,
  };

  // Pass one: a worker drives the prior row through the REAL render gate and
  // dies right after the gate_passed checkpoint — before preview write/queue.
  let prior = lineState.newRow({
    prospectId: "wss-test-prior",
    businessName: "Prior Plumbing",
    vertical: "plumbing",
    email: "prior@x.test",
    now: new Date().toISOString(),
  });
  const passOne = { batchId: "line_wm_resume", lane: "sandbox", seenLogoShas: new Map() };
  for (const expected of ["qualified", "mirrored", "gate_passed"]) {
    const advanced = await runner.processRowPhase(prior, passOne, realDeps);
    assert.equal(advanced.ok, true, JSON.stringify(advanced));
    prior = advanced.row;
    assert.equal(prior.status, expected);
  }
  assert.equal(prior.logoSha256, WORDMARK_SHA, "the durable row carries the claimed fallback sha");

  // Pass two: a fresh worker resumes the durable batch. Its in-memory claim
  // map must re-seed from the gate_passed row, or the sibling ships the same
  // bytes.
  const batch = lineState.newBatch({
    batchId: "line_wm_resume",
    lane: "sandbox",
    target: "",
    requested: 2,
    now: new Date().toISOString(),
    pickState: "complete",
  });
  batch.status = "building";
  batch.rows = [
    { ...prior, rowIndex: 0 },
    {
      ...lineState.newRow({
        prospectId: "wss-test-late",
        businessName: "Late Plumbing",
        vertical: "plumbing",
        email: "late@x.test",
        now: new Date().toISOString(),
      }),
      rowIndex: 1,
    },
  ];
  runner.putBatch(batch);
  const resumed = await runner.startBatch({ batchId: "line_wm_resume", lane: "sandbox" }, { ...realDeps, budgetMs: 0 });
  assert.equal(resumed.ok, true);
  const priorRow = resumed.batch.rows.find((row) => row.prospectId === "wss-test-prior");
  const lateRow = resumed.batch.rows.find((row) => row.prospectId === "wss-test-late");
  assert.equal(priorRow.status, "queued", "the prior claim holder finishes normally");
  assert.equal(lateRow.status, "gate_failed");
  assert.match(lateRow.reason, /already shipped for wss-test-prior/);
  assert.deepEqual(lateRow.failedFacts, ["logo_own_and_unique"]);
});

test("two concurrent rows shipping identical fallback bytes: exactly one wins, the loser is refused by name", async () => {
  runner.resetBatches();
  const deps = {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    pick: async () => [
      { prospectId: "wss-test-red", businessName: "Red Plumbing", vertical: "plumbing", email: "red@x.test" },
      { prospectId: "wss-test-blue", businessName: "Blue Plumbing", vertical: "plumbing", email: "blue@x.test" },
    ],
    qualify: async () => ({ ok: true }),
    mirror: async (row) => ({ ok: true, previewUrl: `https://wss-test-${row.prospectId}.wss-ai.com/` }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    sourceFacts: async (row) => fallbackSource(row.prospectId, row.businessName),
    // The REAL render gate, fed a per-business dom whose only logo is the
    // engine wordmark asset with the SAME bytes for both clients.
    gate: async ({ source, seenLogoShas }) => evaluateRenderGate({
      dom: fallbackDom(source, [{ src: "/assets/brand-logo.svg", sha256: WORDMARK_SHA }]),
      source,
      seenLogoShas,
    }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    onProgress: () => {},
    snapshot: () => {},
    haltCheck: async () => ({ halt: false, reason: "" }),
  };
  const run = await runner.startBatch({ count: 2, lane: "sandbox" }, { ...deps, concurrency: 2, budgetMs: 0 });
  assert.equal(run.ok, true);
  const statuses = run.batch.rows.map((row) => row.status).sort();
  assert.deepEqual(statuses, ["gate_failed", "queued"], JSON.stringify(run.batch.rows.map((r) => [r.prospectId, r.status, r.reason])));
  const winner = run.batch.rows.find((row) => row.status === "queued");
  const loser = run.batch.rows.find((row) => row.status === "gate_failed");
  assert.equal(winner.logoSha256, WORDMARK_SHA, "the winner's durable row carries the claimed fallback sha");
  assert.match(loser.reason, new RegExp(`already shipped for ${winner.prospectId}`));
  assert.deepEqual(loser.failedFacts, ["logo_own_and_unique"]);
});
