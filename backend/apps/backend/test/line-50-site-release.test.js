"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");

const BACKEND = path.join(__dirname, "..");
process.env.MIRROR_DONOR_ROOT = path.join(BACKEND, "donors-clean");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "wss-50-clients-"));

const runner = require("../lib/line-runner");
const lineState = require("../lib/line-state");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { resolveDonor } = require("../lib/mirror-engine/donor");

const VERTICALS = ["concrete", "fencing", "hvac", "landscaping", "med spa", "plumbing", "roofing", "salon", "tattoo"];
const PRIMARY = {
  concrete: "concrete-elconstruction",
  fencing: "fencing-sterling",
  hvac: "hvac-premier",
  landscaping: "landscaping-evergreen",
  "med spa": "medspa-luma",
  plumbing: "plumbing-clean",
  roofing: "roofing-falcon-clean",
  salon: "salon-lacquer-studio",
  tattoo: "tattoo-aurelia",
};
const PLACES = [
  ["Tucson", "AZ"], ["Portland", "OR"], ["Austin", "TX"], ["Spokane", "WA"], ["Denver", "CO"],
  ["Nashville", "TN"], ["Charlotte", "NC"], ["Boise", "ID"], ["Madison", "WI"],
];
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function cohort(count, prefix = "release") {
  return Array.from({ length: count }, (_, i) => {
    const vertical = VERTICALS[i % VERTICALS.length];
    const [city, state] = PLACES[i % PLACES.length];
    return {
      prospectId: `wss-test-${prefix}-${String(i + 1).padStart(2, "0")}`,
      businessName: `Release Proof ${i + 1} ${vertical}`,
      city,
      state,
      vertical,
      email: `owner${String(i + 1).padStart(2, "0")}@woodwardsoftware.com`,
    };
  });
}

function depsFor(input, { failProspectId = "", concurrency = 6 } = {}) {
  const registry = createRegistry();
  const expectedEmail = new Map(input.map((row) => [row.prospectId, row.email]));
  const queued = [];
  let active = 0;
  let maxActive = 0;
  return {
    queued,
    stats: () => ({ maxActive }),
    deps: {
      env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
      pick: async () => input,
      qualify: async () => ({ ok: true }),
      // This suite proves donor hydration/concurrency, not the separately
      // pinned default-on hero lane.
      prepareHero: async () => ({ ok: true, required: false, ready: true }),
      concurrency,
      snapshot: () => {},
      haltCheck: async () => ({ halt: false, reason: "" }),
      mirror: async (row) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (failProspectId && row.prospectId === failProspectId) return { ok: false, reason: "injected_release_proof_failure" };
          const request = {
            slug: `wss-test-${slug(row.businessName)}-${slug(row.city)}`.slice(0, 63),
            facts: { business_name: row.businessName, industry: row.vertical, city: row.city, state: row.state, email: row.email },
          };
          const built = await mirror(request, { dryRun: true, registry });
          if (!built.ok) return { ok: false, reason: `dry_run_${built.status}_${built.body && built.body.error}` };
          return {
            ok: true,
            previewUrl: `https://${request.slug}.wss-ai.com/`,
            buildHash: built.body.build_hash,
            currentWebsite: `https://current-${row.prospectId}.example.com/`,
          };
        } finally { active -= 1; }
      },
      sourceFacts: async (row) => ({ business_name: row.businessName, vertical: row.vertical, email: row.email }),
      gate: async ({ source }) => ({
        pass: true,
        failed: [],
        checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: createHash("sha256").update(source.prospect_id).digest("hex") } }],
      }),
      writePreviewUrl: async (row) => ({ ok: true, rowPatch: { email: row.email } }),
      queueEmail: async (row) => {
        assert.equal(row.email, expectedEmail.get(row.prospectId), `${row.prospectId}: email changed or disappeared`);
        queued.push({ prospectId: row.prospectId, email: row.email });
        return { ok: true };
      },
    },
  };
}

test("all nine Command Center verticals resolve to their declared primary donor", () => {
  for (const vertical of VERTICALS) {
    const out = resolveDonor({ industry: vertical });
    assert.equal(out.ok, true, `${vertical}: ${out.error || "no donor"}`);
    assert.equal(out.manifest.vertical, vertical);
    assert.equal(out.name, PRIMARY[vertical], `${vertical}: deterministic primary donor drift`);
  }
});

test("DEFINITION OF DONE: 50/50 real donor hydrations queue cleanly with intact emails", async () => {
  runner.resetBatches();
  const input = cohort(50, "perfect");
  const harness = depsFor(input, { concurrency: 6 });
  const result = await runner.startBatch({ count: 50, lane: "sandbox", target: "leadminer" }, harness.deps);
  assert.equal(result.ok, true);
  assert.equal(result.batch.rows.length, 50);
  const { maxActive } = harness.stats();
  assert.ok(maxActive > 1, "the proof must actually overlap builds");
  assert.ok(maxActive <= 6, `concurrency escaped its bound: ${maxActive}`);
  const counts = lineState.batchCounts(result.batch);
  assert.equal(counts.queued, 50, JSON.stringify(result.batch.rows.map((r) => ({ id: r.prospectId, status: r.status, reason: r.reason }))));
  assert.equal(counts.failed, 0);
  assert.equal(harness.queued.length, 50);
  assert.equal(new Set(harness.queued.map((row) => row.email)).size, 50);
  assert.ok(result.batch.rows.every((row) => row.status === "queued"), "all 50 rows must reach queue");
  assert.deepEqual([...new Set(result.batch.rows.map((row) => row.vertical))].sort(), [...VERTICALS].sort());
  assert.equal(result.batch.status, "awaiting_approval");
  assert.equal(result.batch.lane, "sandbox");
});

test("fault isolation: one failed site does not abort the other 17", async () => {
  runner.resetBatches();
  const input = cohort(18, "fault");
  const failing = input[7].prospectId;
  const harness = depsFor(input, { failProspectId: failing, concurrency: 6 });
  const result = await runner.startBatch({ count: 18, lane: "sandbox", target: "leadminer" }, harness.deps);
  const counts = lineState.batchCounts(result.batch);
  assert.equal(counts.queued, 17);
  assert.equal(counts.failed, 1);
  assert.equal(harness.queued.length, 17);
  const casualty = result.batch.rows.find((row) => row.prospectId === failing);
  assert.equal(casualty.status, "error");
  assert.equal(casualty.reason, "injected_release_proof_failure");
  assert.ok(result.batch.rows.every((row) => row.status === "queued" || lineState.isFailed(row.status)));
  assert.equal(result.batch.status, "awaiting_approval");
});
