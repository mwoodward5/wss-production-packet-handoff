"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const mirrorRequestSchema = require("../lib/mirror-engine/mirror-request.schema.json");
const { signEvidence } = require("../lib/mirror-engine/evidence-signature");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");

// Patch the store before the fleet module destructures its functions.
const store = require("../lib/store");
const real = { select: store.select, insertRow: store.insertRow, recordEvent: store.recordEvent };
let events = [];
let prospects = [];
let inserted = [];
let recorded = [];
let recordResult = { mode: "live_write" };

store.select = async (table) => {
  if (table === "ghost_agency_events") return { ok: true, data: events };
  if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
  return { ok: false, mode: "unexpected_table" };
};
store.insertRow = async (table, value) => {
  assert.equal(table, "ghost_agency_events");
  if (events.some((event) => event.id === value.id)) {
    return { mode: "live_write_failed", status: 409, error: { code: "23505" } };
  }
  inserted.push(value);
  events = [value, ...events];
  return { mode: "live_write", row: [value] };
};
store.recordEvent = async (type, payload) => {
  recorded.push({ type, payload });
  return recordResult;
};

const fleet = require("../lib/mirror-fleet-identity");
const { composeIdentityCopy, containsBusinessName } = require("../lib/mirror-engine/identity-copy");
const { samenessCheck } = require("../lib/mirror-engine/sameness");
const {
  collisionOnlySamenessFailure,
  samenessFailureDetail,
  mirrorWithSamenessRetry,
} = require("../lib/mirror-lane-build");

test.after(() => Object.assign(store, real));
test.beforeEach(() => {
  events = [];
  prospects = [];
  inserted = [];
  recorded = [];
  recordResult = { mode: "live_write" };
});

function identityEvent(id, payload, createdAt = "2026-08-27T00:00:00.000Z") {
  return { id, type: fleet.EVENT_TYPE, payload, created_at: createdAt };
}

function publishedSuccess(slug) {
  const body = {
    ok: true,
    revealable: true,
    preview_url: `https://${slug}.wss-ai.com/`,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: "a".repeat(64),
    deploy_id: "deployment-sameness-race",
    deploy_url: "https://deployment-sameness-race.vercel.app",
    checks: {
      sameness: { status: "passed", problems: [] },
      alias_target: { status: "passed", deployment_id: "deployment-sameness-race" },
    },
  };
  body.evidence_sha = signEvidence(body);
  return { status: 200, body };
}

test("fingerprint normalization ignores case, punctuation, diacritics, and trailing legal suffixes", () => {
  const a = fleet.fleetFingerprint("  JOSÉ'S Roofing, L.L.C. ", "St. Louis");
  const b = fleet.fleetFingerprint("joses roofing", "ST LOUIS");
  assert.equal(a, b);
  assert.equal(fleet.normalizeBusiness("Acme Builders Corporation"), "acme builders");
});

test("readFleetIdentities excludes the current row by exact slug", async () => {
  events = [
    identityEvent("00000000-0000-4000-8000-000000000001", { slug: "wss-test-acme", h1: "Acme", title: "Acme", prospect_id: "p-1", business_name: "Acme", city: "Austin" }),
    identityEvent("00000000-0000-4000-8000-000000000002", { slug: "wss-test-beta", h1: "Beta", title: "Beta", prospect_id: "p-2", business_name: "Beta", city: "Dallas" }),
  ];
  const out = await fleet.readFleetIdentities({ exceptSlug: "wss-test-acme" });
  assert.deepEqual(out.identities.map((entry) => entry.slug), ["wss-test-beta"]);
});

test("readFleetIdentities excludes a renamed current row by exact prospect_id", async () => {
  events = [identityEvent("00000000-0000-4000-8000-000000000003", {
    slug: "wss-test-old-slug", h1: "Acme", title: "Acme", prospect_id: "prospect-77", business_name: "Acme", city: "Austin",
  })];
  const out = await fleet.readFleetIdentities({ exceptSlug: "wss-test-new-slug", exceptProspectId: "prospect-77" });
  assert.equal(out.identities.length, 0);
});

test("readFleetIdentities excludes a legacy identifier change by exact business-city fingerprint", async () => {
  events = [identityEvent("00000000-0000-4000-8000-000000000004", {
    slug: "wss-test-jose-old", h1: "Jose", title: "Jose", prospect_id: "old-id", business_name: "José Roofing LLC", city: "St. Louis",
  })];
  const out = await fleet.readFleetIdentities({
    exceptSlug: "wss-test-jose-new", exceptProspectId: "new-id", businessName: "JOSE ROOFING", city: "ST LOUIS",
  });
  assert.equal(out.identities.length, 0);
});

test("over-exclusion guard keeps Jen The Builder distinct from Jen The Builder Remodeling so sameness can collide", async () => {
  const headline = "Jen The Builder Remodeling. Remodeling in Austin, TX.";
  const title = "Jen The Builder Remodeling | Remodeling in Austin, TX";
  events = [identityEvent("00000000-0000-4000-8000-000000000005", {
    slug: "wss-test-jen-builder", h1: headline, title, prospect_id: "jen-1", business_name: "Jen The Builder", city: "Austin",
  })];
  const read = await fleet.readFleetIdentities({
    exceptSlug: "wss-test-jen-remodeling", exceptProspectId: "jen-2", businessName: "Jen The Builder Remodeling", city: "Austin",
  });
  assert.equal(read.identities.length, 1, "the longer name must not be fuzzy-excluded");
  const check = samenessCheck({
    slug: "wss-test-jen-remodeling",
    facts: { business_name: "Jen The Builder Remodeling", city: "Austin" },
    marketCity: "Austin",
    copy: { lines: { a: "Jen The Builder Remodeling." }, headline, source: "verified_facts", basis: [] },
    donorFiles: { "index.html": Buffer.from("<h1>{{HERO_LINE_A}}</h1>") },
    files: { "index.html": Buffer.from(`<title>${title}</title>`) },
    renderedH1: headline,
    fleet: read.identities,
  });
  assert.ok(check.problems.some((problem) => problem.startsWith("duplicate_h1_with_wss-test-jen-builder:")));
});

test("recordFleetIdentity persists prospect_id and the normalized fingerprint", async () => {
  const out = await fleet.recordFleetIdentity({
    slug: "wss-test-acme", h1: "Acme", title: "Acme | Austin", prospect_id: "prospect-9", business_name: "Acme LLC", city: "Austin",
  });
  assert.equal(out.ok, true);
  assert.equal(recorded[0].payload.prospect_id, "prospect-9");
  assert.equal(recorded[0].payload.fingerprint, fleet.fleetFingerprint("Acme LLC", "Austin"));
});

test("recordFleetIdentity requires a confirmed durable event write", async () => {
  const input = {
    slug: "wss-test-write-proof",
    h1: "Write Proof",
    title: "Write Proof | Austin",
    prospect_id: "prospect-write-proof",
    business_name: "Write Proof LLC",
    city: "Austin",
  };
  for (const [result, reason] of [
    [{ mode: "dry_run" }, "dry_run"],
    [{ mode: "live_write_failed", error: { code: "network_error" } }, "network_error"],
    [null, "fleet_identity_write_unconfirmed"],
  ]) {
    recordResult = result;
    const out = await fleet.recordFleetIdentity(input);
    assert.equal(out.ok, false);
    assert.equal(out.reason, reason);
  }
});

test("legacy backfill is idempotent and a newer tombstone cannot be resurrected", async () => {
  const legacy = identityEvent("00000000-0000-4000-8000-000000000006", {
    slug: "wss-test-legacy", h1: "Legacy", title: "Legacy | Austin",
  }, "2026-08-27T00:00:00.000Z");
  events = [legacy];
  prospects = [{ prospect_id: "prospect-legacy", business_name: "Legacy Builders LLC", city: "Austin", site_slug: "wss-test-legacy" }];
  const first = await fleet.readFleetIdentities({ exceptProspectId: "prospect-legacy", businessName: "Legacy Builders", city: "Austin" });
  assert.equal(first.identities.length, 0, "the exclusion is active in the same read that writes the successor");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].payload.supersedes_event_id, legacy.id);
  assert.equal(inserted[0].payload.prospect_id, "prospect-legacy");

  events = [legacy];
  inserted = [];
  const preview = await fleet.readFleetIdentities({
    exceptProspectId: "prospect-legacy", businessName: "Legacy Builders", city: "Austin", writeBackfill: false,
  });
  assert.equal(preview.identities.length, 0, "dry-run still excludes the legacy current identity in memory");
  assert.equal(inserted.length, 0, "dry-run writes no successor event");

  events = [legacy];
  await fleet.readFleetIdentities({ exceptProspectId: "prospect-legacy", businessName: "Legacy Builders", city: "Austin" });

  await fleet.readFleetIdentities({ exceptProspectId: "prospect-legacy", businessName: "Legacy Builders", city: "Austin" });
  assert.equal(inserted.length, 1, "a replay reuses the deterministic successor instead of appending another row");

  events = [identityEvent("00000000-0000-4000-8000-000000000007", {
    slug: "wss-test-legacy", retired: true,
  }, "2026-08-28T00:00:00.000Z"), ...events];
  const retired = await fleet.readFleetIdentities({});
  assert.equal(retired.identities.length, 0, "the successor cannot outrank the newer ordinary tombstone");

  const successorOnly = inserted[0];
  assert.deepEqual(
    fleet.resolveFleetHeads([successorOnly]).map((event) => event.payload.slug),
    ["wss-test-legacy"],
    "a successor remains the head after its old source falls outside the capped query",
  );

  const orphanAfterTombstone = {
    ...successorOnly,
    created_at: "2026-08-29T00:00:00.000Z",
  };
  const newerTombstone = identityEvent("00000000-0000-4000-8000-000000000008", {
    slug: "wss-test-legacy", retired: true,
  }, "2026-08-28T00:00:00.000Z");
  assert.equal(
    fleet.resolveFleetHeads([orphanAfterTombstone, newerTombstone])[0].payload.retired,
    true,
    "an orphan successor cannot outrank an ordinary tombstone even when the stale backfill was written later",
  );

  const newerIdentity = identityEvent("00000000-0000-4000-8000-000000000009", {
    slug: "wss-test-legacy", h1: "Current", title: "Current", prospect_id: "prospect-current",
    business_name: "Current Builders", city: "Austin",
  }, "2026-08-28T00:00:00.000Z");
  assert.equal(
    fleet.resolveFleetHeads([orphanAfterTombstone, newerIdentity])[0].payload.h1,
    "Current",
    "an orphan successor cannot replace a newer ordinary identity",
  );
});

test("composeIdentityCopy guarantees the business name and attempt 2 differentiates only verified atoms", () => {
  const facts = { business_name: "Acme Roofing, LLC", industry: "roofing", city: "Austin", state: "TX" };
  const first = composeIdentityCopy({ facts, marketCity: "Austin", hero: { headline: "Roofs built for Texas weather" } });
  assert.equal(containsBusinessName(first.headline, "Acme Roofing LLC"), true);
  const second = composeIdentityCopy({ facts, marketCity: "Austin", hero: { headline: "Roofs built for Texas weather", attempt: 2 } });
  assert.equal(second.identity_attempt, 2);
  assert.equal(containsBusinessName(second.headline, "Acme Roofing LLC"), true);
  assert.notEqual(second.headline, first.headline);
  assert.match(second.title, /Roofing in Austin, TX \| Acme Roofing, LLC/);
  const lineAOnly = samenessCheck({
    slug: "wss-test-line-a-only",
    facts,
    marketCity: "Austin",
    copy: first,
    donorFiles: { "index.html": Buffer.from("<h1>{{HERO_LINE_A}}</h1>") },
    files: { "index.html": Buffer.from("<title>Acme Roofing, LLC | Roofing in Austin, TX</title>") },
    renderedH1: "Roofs built for Texas weather.",
  });
  assert.ok(lineAOnly.problems.some((problem) => problem.startsWith("rendered_h1_not_client_derived:")));
});

test("only collision-only failures share one atomically claimed, resumable attempt 2 and preserve refusal detail", async () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addSchema(mirrorRequestSchema);
  const validateHero = ajv.compile({ $ref: `${mirrorRequestSchema.$id}#/$defs/MirrorHero` });
  assert.equal(validateHero({ attempt: 2 }), false, "attempt 2 is not a public request field");
  assert.equal(validateHero({ attempt: 2, retryOf: "build-1", retryReason: "sameness_collision" }), false,
    "fabricated retry metadata cannot self-authorize through the public schema");
  const collision = (slug) => ({
    status: 200,
    body: { ok: true, revealable: false, checks: { sameness: { status: "failed", problems: [`duplicate_h1_with_${slug}: \"same\"`] } } },
  });
  assert.equal(collisionOnlySamenessFailure(collision("other")), true);
  assert.equal(collisionOnlySamenessFailure({ body: { checks: { sameness: { problems: ["duplicate_h1_with_other: same", "rendered_h1_not_client_derived: donor"] } } } }), false);
  assert.deepEqual(samenessFailureDetail(collision("other")), {
    gate: "sameness", problems: ["duplicate_h1_with_other: \"same\""],
  });

  let firstCalls = 0;
  let retryCalls = 0;
  const retryIdentities = [];
  const args = {
    run: async (_request, options) => {
      if (options.internalSamenessRetry?.attempt === 2) {
        retryCalls += 1;
        assert.equal(options.internalSamenessRetry.retryReason, "sameness_collision");
        assert.ok(options.internalSamenessRetry.claimId);
      retryIdentities.push({
          operationKey: options.operationKey,
          retryOf: options.internalSamenessRetry.retryOf,
          claimId: options.internalSamenessRetry.claimId,
        });
        return publishedSuccess("wss-test-retry");
      }
      firstCalls += 1;
      return collision("existing");
    },
    readFleet: async () => ({ ok: true, identities: [] }),
    recordFleet: async () => ({ ok: true, mode: "live_write" }),
    claimRetry: fleet.claimSamenessRetry,
    request: { slug: "wss-test-retry", facts: { business_name: "Retry Roofing", city: "Austin" }, hero: {} },
    prospectId: "prospect-retry",
    operationKey: "line:batch-1:row-1:mirror",
    dryRun: false,
  };
  const results = await Promise.all([mirrorWithSamenessRetry(args), mirrorWithSamenessRetry(args)]);
  assert.equal(firstCalls, 2);
  assert.equal(retryCalls, 2, "a concurrent loser resumes the same logical attempt so it cannot leave attempt 1 public");
  assert.equal(inserted.length, 1, "the deterministic event primary key records one logical attempt-2 fact");
  assert.equal(new Set(retryIdentities.map((identity) => JSON.stringify(identity))).size, 1,
    "every resume uses the same immutable claim and provider operation key");
  assert.equal(inserted[0].payload.attempt, 2);
  assert.equal(inserted[0].payload.retry_count, 1);
  assert.equal(inserted[0].payload.retryOf, args.operationKey);
  assert.equal(inserted[0].payload.retryReason, "sameness_collision");
  assert.equal(results.filter((result) => result.body.revealable).length, 2);

  let dryRunClaims = 0;
  const dryRunResult = await mirrorWithSamenessRetry({
    ...args,
    dryRun: true,
    claimRetry: async () => { dryRunClaims += 1; return { ok: true, claimed: true }; },
  });
  assert.equal(dryRunClaims, 0, "dry-run cannot burn the durable attempt-2 claim");
  assert.equal(dryRunResult.body.revealable, false);

  let terminalClaims = 0;
  await mirrorWithSamenessRetry({
    ...args,
    run: async () => ({ body: { checks: { sameness: { status: "failed", problems: ["duplicate_title_with_x: same", "served_title_missing_business_name: wrong"] } } } }),
    claimRetry: async () => { terminalClaims += 1; return { ok: true, claimed: true }; },
  });
  assert.equal(terminalClaims, 0, "mixed donor/name failures stay terminal");
});

test("a stale claim resumes after a crashed worker and retains one immutable attempt-2 identity", async () => {
  const operationKey = "line:batch-crash:row-1:mirror";
  const claimed = await fleet.claimSamenessRetry({
    retryOf: operationKey,
    slug: "wss-test-crash-resume",
    prospect_id: "prospect-crash-resume",
  });
  assert.equal(claimed.claimed, true);
  assert.equal(inserted.length, 1);

  const wrongIdentity = await fleet.claimSamenessRetry({
    retryOf: operationKey,
    slug: "wss-test-different-client",
    prospect_id: "prospect-different-client",
  });
  assert.equal(wrongIdentity.ok, false, "a deterministic operation key cannot authorize another prospect's attempt 2");
  assert.equal(wrongIdentity.reason, "retry_claim_identity_unavailable");

  const retryOptions = [];
  let retryAttempt = 0;
  const collision = {
    status: 200,
    body: { ok: true, revealable: false, checks: { sameness: { status: "failed", problems: ["duplicate_h1_with_existing: same"] } } },
  };
  const resumeArgs = {
    run: async (_request, options) => {
      if (options.internalSamenessRetry?.attempt === 2) {
        retryOptions.push(options);
        retryAttempt += 1;
        if (retryAttempt === 1) {
          return { status: 502, body: { ok: false, revealable: false, error: "shared_stage_failed" } };
        }
        return publishedSuccess("wss-test-crash-resume");
      }
      return collision;
    },
    readFleet: async () => ({ ok: true, identities: [] }),
    recordFleet: async () => ({ ok: true, mode: "live_write" }),
    claimRetry: fleet.claimSamenessRetry,
    request: { slug: "wss-test-crash-resume", facts: { business_name: "Crash Roofing", city: "Austin" }, hero: {} },
    prospectId: "prospect-crash-resume",
    operationKey,
    dryRun: false,
  };
  const transient = await mirrorWithSamenessRetry(resumeArgs);
  assert.equal(transient.status, 502, "the first resumed worker can still lose a transient provider call");
  const resumed = await mirrorWithSamenessRetry(resumeArgs);
  assert.equal(resumed.body.revealable, true, "the immutable claim remains resumable after the transient");
  assert.equal(inserted.length, 1, "resume reuses the original atomic claim row");
  assert.equal(retryOptions.length, 2);
  for (const options of retryOptions) {
    assert.equal(options.operationKey, claimed.operationKey);
    assert.deepEqual(options.internalSamenessRetry, {
      attempt: 2,
      retryOf: claimed.retryOf,
      retryReason: "sameness_collision",
      claimId: claimed.id,
    });
  }
});

test("a late legacy attempt-1 alias is repaired by the conflict resuming identical attempt 2", async () => {
  let publicAlias = "base";
  let firstAttemptNumber = 0;
  let releaseSecondFirst;
  const secondFirstMayFinish = new Promise((resolve) => { releaseSecondFirst = resolve; });
  let winnerRetryFinished;
  const winnerRetryDone = new Promise((resolve) => { winnerRetryFinished = resolve; });
  const retryKeys = [];
  const collision = {
    status: 200,
    body: { ok: true, revealable: false, checks: { sameness: { status: "failed", problems: ["duplicate_title_with_existing: same"] } } },
  };
  const run = async (_request, options) => {
    if (options.internalSamenessRetry?.attempt === 2) {
      retryKeys.push(options.operationKey);
      publicAlias = "attempt2";
      if (retryKeys.length === 1) {
        winnerRetryFinished();
        releaseSecondFirst();
      }
      return publishedSuccess("wss-test-alias-race");
    }
    firstAttemptNumber += 1;
    if (firstAttemptNumber === 2) {
      await secondFirstMayFinish;
      await winnerRetryDone;
    }
    publicAlias = "attempt1";
    return collision;
  };
  const args = {
    run,
    readFleet: async () => ({ ok: true, identities: [] }),
    recordFleet: async () => ({ ok: true, mode: "live_write" }),
    claimRetry: fleet.claimSamenessRetry,
    request: { slug: "wss-test-alias-race", facts: { business_name: "Alias Roofing", city: "Austin" }, hero: {} },
    prospectId: "prospect-alias-race",
    operationKey: "line:batch-alias:row-1:mirror",
    dryRun: false,
  };
  const [a, b] = await Promise.all([mirrorWithSamenessRetry(args), mirrorWithSamenessRetry(args)]);
  assert.equal(a.body.revealable, true);
  assert.equal(b.body.revealable, true);
  assert.equal(publicAlias, "attempt2", "the last worker cannot leave its late attempt-1 alias public");
  assert.equal(inserted.length, 1);
  assert.equal(retryKeys.length, 2);
  assert.equal(new Set(retryKeys).size, 1, "both workers resume one deterministic provider operation");
});
