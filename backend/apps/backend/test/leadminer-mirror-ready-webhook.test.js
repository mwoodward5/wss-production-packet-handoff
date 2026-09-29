"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const receiverPath = require.resolve("../api/webhooks/leadminer");
const storePath = require.resolve("../lib/store");
const wakeupPath = require.resolve("../lib/line-packet-wakeup");
const originalReceiver = require.cache[receiverPath];
const originalStore = require.cache[storePath];
const originalWakeup = require.cache[wakeupPath];
const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const SECRET = "leadminer-contract-test-secret";
const NOW_MS = Date.parse("2026-08-05T06:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));

function provenance(source, sourceKind = "website") {
  return {
    captured_at: "2026-08-05T05:31:00.000Z",
    source_kind: sourceKind,
    source,
  };
}

function mirrorReadyLead(overrides = {}) {
  const places = "https://places.googleapis.com/v1/places/ChIJGhostFixture123";
  const website = "https://fixture-plumbing.example/";
  const services = `${website}services`;
  const lead = {
    business_name: "Fixture Plumbing Company",
    place_id: "ChIJGhostFixture123",
    industry: "plumber",
    phone_e164: "+15595550112",
    email: "owner@fixture-plumbing.example",
    email_source_url: `${website}contact`,
    email_domain_class: "own_domain",
    website_url: website,
    website_status: "legacy_cms",
    website_grade: "D",
    opportunity_score: 86,
    street: "100 Fixture Way",
    city: "Fresno",
    state: "CA",
    zip: "93721",
    lat: 36.7378,
    lng: -119.7871,
    rating: 4.8,
    review_count: 214,
    gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJGhostFixture123",
    reviews: [{
      author: "Fixture Reviewer",
      rating: 5,
      text: "Fixture review text preserved exactly.",
      published_at: "2026-07-10T12:00:00Z",
      author_photo_url: "https://lh3.googleusercontent.com/a-/fixture-author-photo-token",
    }],
    logo_url: `${website}assets/logo.svg`,
    logo_source_url: website,
    logo_on_own_domain: true,
    brand_colors: { primary: "#123ABC", accent: "#F59E0B" },
    photos: [{ url: `${website}assets/service-truck.jpg`, source: "own_site" }],
    services: [{ name: "Drain cleaning", description: "Same-day drain clearing" }],
    social: [{ platform: "facebook", url: "https://facebook.com/fixture-plumbing" }],
    credits_spent: 0,
    provenance: {
      "/business_name": provenance(places, "google_places_api"),
      "/place_id": provenance(places, "google_places_api"),
      "/industry": provenance("leadminer:project-trade:plumber", "leadminer_derived"),
      "/phone_e164": provenance(places, "google_places_api"),
      "/email": provenance(`${website}contact`),
      "/email_source_url": provenance(`${website}contact`),
      "/email_domain_class": provenance(`${website}contact`),
      "/website_url": provenance(places, "google_places_api"),
      "/website_status": provenance("leadminer:website-chip:v1", "leadminer_derived"),
      "/website_grade": provenance("leadminer:website-grade:v1", "leadminer_derived"),
      "/opportunity_score": provenance("leadminer:opportunity-score:v2", "leadminer_derived"),
      "/street": provenance(places, "google_places_api"),
      "/city": provenance(places, "google_places_api"),
      "/state": provenance(places, "google_places_api"),
      "/zip": provenance(places, "google_places_api"),
      "/lat": provenance(places, "google_places_api"),
      "/lng": provenance(places, "google_places_api"),
      "/rating": provenance(places, "google_places_api"),
      "/review_count": provenance(places, "google_places_api"),
      "/gbp_url": provenance(places, "google_places_api"),
      "/reviews/0/author": provenance(places, "google_places_api"),
      "/reviews/0/rating": provenance(places, "google_places_api"),
      "/reviews/0/text": provenance(places, "google_places_api"),
      "/reviews/0/published_at": provenance(places, "google_places_api"),
      "/reviews/0/author_photo_url": provenance(places, "google_places_api"),
      "/logo_url": provenance(website),
      "/logo_source_url": provenance(website),
      "/logo_on_own_domain": provenance(website),
      "/brand_colors/primary": provenance(website),
      "/brand_colors/accent": provenance(website),
      "/photos/0/url": provenance(`${website}gallery`),
      "/photos/0/source": provenance(`${website}gallery`),
      "/services/0/name": provenance(services),
      "/services/0/description": provenance(services),
      "/social/0/platform": provenance(website),
      "/social/0/url": provenance(website),
      "/credits_spent": provenance("credit_ledger:lead:fixture", "credit_ledger"),
    },
  };
  return { ...lead, ...overrides };
}

function headers(overrides = {}) {
  return {
    "x-leadminer-timestamp": TIMESTAMP,
    "x-leadminer-signature": `sha256=${"0".repeat(64)}`,
    "x-leadminer-event": "lead.enriched",
    "x-leadminer-project": "77b49cb6-2eb1-46bc-8c0b-c5e65a172f08",
    "x-leadminer-delivery": "08c539c4-8534-4775-af0a-194d8cc5c28a",
    "x-leadminer-idempotency-key": `mirror-ready:${"a".repeat(64)}`,
    "x-leadminer-schema-version": "1.0",
    ...overrides,
  };
}

function sign(rawBody, timestamp = TIMESTAMP, secret = SECRET) {
  return `sha256=${crypto.createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex")}`;
}

function requestFor(payload, headerOverrides = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const requestTimestamp = String(Math.floor(Date.now() / 1000));
  return {
    method: "POST",
    body: rawBody,
    headers: headers({
      "x-leadminer-timestamp": requestTimestamp,
      "x-leadminer-signature": sign(rawBody, requestTimestamp),
      ...headerOverrides,
    }),
  };
}

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value = "") { this.body = value; },
  };
}

function loadReceiver(store = {}, wakeup = {}) {
  delete require.cache[receiverPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      select: async () => ({ ok: true, data: [] }),
      insertRow: async () => ({ mode: "live_write" }),
      upsertRow: async () => ({ mode: "live_upsert" }),
      recordEvent: async () => ({ mode: "live_write" }),
      ...store,
    },
  };
  require.cache[wakeupPath] = {
    id: wakeupPath,
    filename: wakeupPath,
    loaded: true,
    exports: {
      wakeNewestBuildingPracticeBatch: async () => ({
        accepted: false,
        recovery: "cron",
        reason: "no_active_practice_batch",
      }),
      ...wakeup,
    },
  };
  return require(receiverPath);
}

function restore() {
  delete require.cache[receiverPath];
  if (originalReceiver) require.cache[receiverPath] = originalReceiver;
  else delete require.cache[receiverPath];
  if (originalStore) require.cache[storePath] = originalStore;
  else delete require.cache[storePath];
  if (originalWakeup) require.cache[wakeupPath] = originalWakeup;
  else delete require.cache[wakeupPath];
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

test.afterEach(restore);

test("LeadMiner signature binds the exact raw bytes and expires after five minutes", () => {
  const receiver = loadReceiver();
  const rawBody = Buffer.from('[{"business_name":"Exact bytes"}]\n', "utf8");
  const signature = sign(rawBody);

  assert.equal(receiver.verifyLeadMinerSignature({
    rawBody, signature, timestamp: TIMESTAMP, secret: SECRET, nowMs: NOW_MS,
  }).verified, true);
  assert.equal(receiver.verifyLeadMinerSignature({
    rawBody: Buffer.from(rawBody.toString("utf8").trim(), "utf8"),
    signature,
    timestamp: TIMESTAMP,
    secret: SECRET,
    nowMs: NOW_MS,
  }).verified, false, "parsing or reserializing must invalidate the signature");
  assert.equal(receiver.verifyLeadMinerSignature({
    rawBody,
    signature,
    timestamp: TIMESTAMP,
    secret: SECRET,
    nowMs: NOW_MS + 301_000,
  }).verified, false, "replays older than five minutes must fail closed");
  assert.equal(receiver.verifyLeadMinerSignature({
    rawBody,
    signature: "sha256=not-hex",
    timestamp: TIMESTAMP,
    secret: SECRET,
    nowMs: NOW_MS,
  }).verified, false);
});

test("handler rejects decoded strings and parsed objects because signed bytes were lost", async () => {
  process.env.GHOST_AGENCY_LEADMINER_WEBHOOK_SECRET = SECRET;
  let storageCalls = 0;
  const receiver = loadReceiver({
    select: async () => {
      storageCalls += 1;
      return { ok: true, data: [] };
    },
  });
  assert.equal(receiver.config?.api?.bodyParser, false, "Vercel must leave the signed request bytes untouched");
  const payload = [mirrorReadyLead()];
  const signed = requestFor(payload);

  for (const decodedBody of [signed.body.toString("utf8"), payload]) {
    const captured = responseCapture();
    await receiver({ ...signed, body: decodedBody }, captured);
    assert.equal(captured.statusCode, 400, captured.body);
    assert.equal(JSON.parse(captured.body).error, "leadminer_raw_body_unavailable");
  }
  assert.equal(storageCalls, 0, "unverifiable bodies must fail before any storage work");
});

test("all LeadMiner routing, delivery, replay, and schema headers are required", () => {
  const receiver = loadReceiver();
  assert.equal(receiver.validateLeadMinerHeaders(headers()).event, "lead.enriched");

  for (const name of Object.keys(headers())) {
    const incomplete = headers();
    delete incomplete[name];
    assert.throws(
      () => receiver.validateLeadMinerHeaders(incomplete),
      (error) => error?.code === "leadminer_header_missing",
      `${name} must be required`,
    );
  }

  assert.throws(
    () => receiver.validateLeadMinerHeaders(headers({ "x-leadminer-event": "lead.deleted" })),
    (error) => error?.code === "leadminer_event_invalid",
  );
  assert.throws(
    () => receiver.validateLeadMinerHeaders(headers({ "x-leadminer-schema-version": "2.0" })),
    (error) => error?.code === "leadminer_schema_unsupported",
  );
});

test("batch validation accepts only 1-25 sourced, Google-identified records", () => {
  const receiver = loadReceiver();
  assert.equal(receiver.validateLeadBatch([mirrorReadyLead()]).length, 1);
  for (const invalid of [
    [],
    Array.from({ length: 26 }, (_, index) => mirrorReadyLead({
      place_id: `ChIJGhostFixture${String(index).padStart(3, "0")}`,
    })),
    { lead: mirrorReadyLead() },
    [mirrorReadyLead({ place_id: "fc_https_fixture" })],
    [mirrorReadyLead({ place_id: "" })],
  ]) {
    assert.throws(() => receiver.validateLeadBatch(invalid));
  }

  const missingEvidence = mirrorReadyLead();
  delete missingEvidence.provenance["/email"];
  assert.throws(
    () => receiver.validateLeadBatch([missingEvidence]),
    /provenance|email/i,
    "every emitted fact needs provenance",
  );

  const missingGenericEvidence = mirrorReadyLead();
  delete missingGenericEvidence.provenance["/rating"];
  assert.throws(
    () => receiver.validateLeadBatch([missingGenericEvidence]),
    /provenance|rating/i,
    "non-contact facts also require their own source pointer",
  );
});

test("published email may omit domain class, but a supplied invalid class is rejected", () => {
  const receiver = loadReceiver();
  const withoutDomainClass = mirrorReadyLead();
  delete withoutDomainClass.email_domain_class;
  delete withoutDomainClass.provenance["/email_domain_class"];

  const [accepted] = receiver.validateLeadBatch([withoutDomainClass]);
  assert.equal(accepted.email, withoutDomainClass.email);
  assert.equal(accepted.email_source_url, withoutDomainClass.email_source_url);
  assert.equal(Object.hasOwn(accepted, "email_domain_class"), false);

  const invalidDomainClass = mirrorReadyLead({ email_domain_class: "catch_all" });
  assert.throws(
    () => receiver.validateLeadBatch([invalidDomainClass]),
    (error) => error?.code === "leadminer_email_invalid",
    "a present domain class must use an allowed verified value",
  );
});

test("Mirror-Ready maps to reusable truth and the packet stage skips discovery fallback", async () => {
  const receiver = loadReceiver();
  const lead = mirrorReadyLead();
  const packet = receiver.buildTruthPacket(lead, {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    schemaVersion: "1.0",
  });

  assert.equal(packet.meta.source, "leadminer_mirror_ready");
  assert.equal(packet.identity.name.value, lead.business_name);
  assert.equal(packet.identity.category.value, "plumber");
  assert.ok(packet.intakeGenie.assets.some((asset) => asset.kind === "logo" && asset.verified === true));
  assert.ok(packet.intakeGenie.assets.some((asset) => asset.kind === "photo" && asset.verified === true));
  assert.ok(packet.intakeGenie.evidence.some((row) => row.field === "services" && row.verified === true));
  assert.equal(packet.intakeGenie.facts.email, lead.email);
  assert.equal(packet.intakeGenie.facts.email_source_url, lead.email_source_url);
  assert.deepEqual(packet.intakeGenie.facts.reviews, lead.reviews);

  const prospect = receiver.leadToProspect(lead, {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    deliveryId: headers()["x-leadminer-delivery"],
    idempotencyKey: headers()["x-leadminer-idempotency-key"],
    schemaVersion: "1.0",
  });
  let fallbackCalls = 0;
  const { packetProspectForConsent } = require("../lib/full-run");
  const packeted = await packetProspectForConsent(prospect, {
    persist: false,
    truthPacketWithLocalPlan: async () => {
      fallbackCalls += 1;
      throw new Error("LeadMiner truth must prevent provider fallback");
    },
  });
  assert.equal(packeted.ok, true, JSON.stringify(packeted));
  assert.equal(fallbackCalls, 0);
});

test("stored Mirror-Ready truth builds without discovery and incomplete truth holds without fallback", async () => {
  const receiver = loadReceiver();
  const complete = receiver.leadToProspect(mirrorReadyLead(), {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    deliveryId: headers()["x-leadminer-delivery"],
    idempotencyKey: headers()["x-leadminer-idempotency-key"],
    schemaVersion: "1.0",
  });
  const ownedPhotoBank = {
    version: 1,
    harvested_at: new Date().toISOString(),
    website: "https://fixture-plumbing.example/",
    photos: [{
      url: "https://fixture-plumbing.example/assets/service-truck.jpg",
      source: "own_site",
      found_on: "https://fixture-plumbing.example/gallery",
      width: 1600,
      height: 900,
      bytes: 125000,
      ext: "jpg",
      sha256: "a".repeat(64),
      grade: "hero",
      rank: 1,
    }],
  };
  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const calls = { facts: 0, photos: 0, donor: 0, mirror: 0 };
  let mirrorRequest;
  const built = await buildMirrorForProspect({
    prospect_id: complete.prospect_id,
    record: { ...complete.record, photo_bank: ownedPhotoBank },
    truth_packet: complete.truth_packet,
    truth_packet_source: complete.truth_packet_source,
  }, {
    dryRun: true,
    deps: {
      resolveVerifiedFacts: async () => {
        calls.facts += 1;
        throw new Error("Google/CallPrep resolver must not run for stored Mirror-Ready truth");
      },
      harvestClientPhotos: async () => {
        calls.photos += 1;
        throw new Error("Firecrawl/site harvesting must not run for stored Mirror-Ready truth");
      },
      resolveBuildableDonor: (industry) => {
        calls.donor += 1;
        assert.equal(industry, "plumbing");
        return { ok: true, donor: "fixture-plumbing-donor", vertical: "plumbing" };
      },
      mirror: async (request, options) => {
        calls.mirror += 1;
        mirrorRequest = request;
        assert.equal(options.dryRun, true);
        return {
          status: 200,
          body: {
            ok: true,
            revealable: true,
            preview_url: "https://fixture-plumbing-preview.wss-ai.com/",
          },
        };
      },
    },
  });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.deepEqual(calls, { facts: 0, photos: 0, donor: 1, mirror: 1 });
  assert.deepEqual(built.provider_calls, { google: 0, firecrawl: 0, intake_genie: 0 });
  assert.equal(mirrorRequest.facts.place_id, "ChIJGhostFixture123");
  assert.equal(mirrorRequest.brand.logo, "https://fixture-plumbing.example/assets/logo.svg");
  assert.deepEqual(mirrorRequest.brand.photos, ["https://fixture-plumbing.example/assets/service-truck.jpg"]);
  assert.deepEqual(built.owned_photo_bank, ownedPhotoBank);
  assert.equal(mirrorRequest.content.services[0].name, "Drain cleaning");

  const incompleteLead = mirrorReadyLead({ photos: [] });
  delete incompleteLead.provenance["/photos/0/url"];
  delete incompleteLead.provenance["/photos/0/source"];
  const incomplete = receiver.leadToProspect(incompleteLead, {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    deliveryId: headers()["x-leadminer-delivery"],
    idempotencyKey: headers()["x-leadminer-idempotency-key"],
    schemaVersion: "1.0",
  });
  const blockedCalls = { facts: 0, photos: 0, donor: 0, mirror: 0, intake: 0 };
  const blocked = await buildMirrorForProspect({
    prospect_id: incomplete.prospect_id,
    truth_packet: incomplete.truth_packet,
    truth_packet_source: incomplete.truth_packet_source,
  }, {
    deps: {
      resolveVerifiedFacts: async () => { blockedCalls.facts += 1; },
      harvestClientPhotos: async () => { blockedCalls.photos += 1; },
      resolveBuildableDonor: () => { blockedCalls.donor += 1; },
      mirror: async () => { blockedCalls.mirror += 1; },
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "leadminer_truth_packet_incomplete");
  assert.ok(blocked.missing.includes("build_ready") || blocked.missing.includes("photos"));
  assert.deepEqual(blockedCalls, { facts: 0, photos: 0, donor: 0, mirror: 0, intake: 0 });

  const { packetProspectForConsent } = require("../lib/full-run");
  const packeted = await packetProspectForConsent(incomplete, {
    persist: false,
    truthPacketWithLocalPlan: async () => {
      blockedCalls.intake += 1;
      throw new Error("incomplete LeadMiner truth must hold, not call Intake Genie");
    },
  });
  assert.equal(packeted.ok, false);
  assert.equal(packeted.status, "held");
  assert.equal(packeted.blocked, "leadminer_truth_packet_incomplete");
  assert.equal(blockedCalls.intake, 0);
});

test("incomplete build evidence is persisted as held, never guessed ready", () => {
  const receiver = loadReceiver();
  const lead = mirrorReadyLead({ photos: [] });
  delete lead.provenance["/photos/0/url"];
  delete lead.provenance["/photos/0/source"];
  const prospect = receiver.leadToProspect(lead, {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    deliveryId: headers()["x-leadminer-delivery"],
    idempotencyKey: headers()["x-leadminer-idempotency-key"],
    schemaVersion: "1.0",
  });

  assert.equal(prospect.status, "held");
  assert.match(String(prospect.blocked_reason || prospect.record?.blocked_reason), /mirror|evidence|asset|photo/i);
  assert.equal(prospect.preview_url, undefined);
  assert.equal(prospect.report_url, undefined);
  assert.equal(prospect.truth_packet.intakeGenie.assets.some((asset) => asset.kind === "photo"), false);
});

test("an existing prospect keeps its workflow state and gains no invented owner or consent", async () => {
  const receiver = loadReceiver();
  const writes = [];
  const lead = mirrorReadyLead();
  const result = await receiver._test.persistLead(lead, {
    capturedAt: "2026-08-05T06:00:00.000Z",
    projectId: headers()["x-leadminer-project"],
    deliveryId: headers()["x-leadminer-delivery"],
    idempotencyKey: headers()["x-leadminer-idempotency-key"],
    schemaVersion: "1.0",
  }, {
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: "existing-prospect",
        status: "contacted",
        record: { status: "contacted", existing_fact: "keep me" },
      }],
    }),
    upsertRow: async (table, row, conflict) => {
      writes.push({ table, row, conflict });
      return { mode: "live_upsert", row: [row] };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  const saved = writes[0].row;
  assert.equal(saved.prospect_id, "existing-prospect");
  assert.equal(saved.status, "contacted", "ingestion must not reactivate or hold an existing workflow row");
  assert.equal(saved.record.status, "contacted");
  assert.equal(saved.record.existing_fact, "keep me");
  assert.deepEqual(saved.record.leadminer_mirror_ready, lead);
  assert.equal(saved.record.place_id, lead.place_id, "the registry-resolved Google Place ID remains the identity spine");
  assert.equal(saved.record.contact_enrichment.outreach.review_hold, true);
  assert.ok(saved.record.contact_enrichment.outreach.hold_reasons.includes("email_confidence_below_threshold"));
  assert.equal(saved.record.contact_enrichment.outreach.sendable_email, null);
  assert.equal(Object.hasOwn(saved, "owner_email"), false);
  assert.equal(Object.hasOwn(saved, "consent_to_call"), false);
  assert.equal(Object.hasOwn(saved, "consent_to_text"), false);
  assert.equal(Object.hasOwn(saved.record, "autosend"), false);
  assert.equal(Object.hasOwn(saved.record, "build_dispatch"), false);
});

test("handler refreshes canonical truth, deduplicates, and performs no build, send, publish, or provider work", async () => {
  process.env.GHOST_AGENCY_LEADMINER_WEBHOOK_SECRET = SECRET;
  const freshLead = mirrorReadyLead();
  const staleTruthPacket = {
    meta: { source: "historic_truth" },
    mirror_ready: { brand_colors: { primary: "#111111", accent: "#222222" } },
    intakeGenie: { facts: { brand_colors: { primary: "#111111", accent: "#222222" } } },
  };
  const existingProspect = {
    prospect_id: "existing-prospect",
    canonical_prospect_id: "existing-prospect",
    canonical_place_id: freshLead.place_id,
    status: "contacted",
    source: "historic_import",
    record: {
      status: "contacted",
      source: "historic_import",
      truth_packet: staleTruthPacket,
      truth_packet_source: "historic_truth",
    },
  };
  let receiptRow = null;
  const writes = [];
  const inserts = [];
  const events = [];
  const operations = [];
  let queueWakeCalls = 0;
  const receiver = loadReceiver({
    select: async (table) => ({
      ok: true,
      data: table === "ghost_agency_events"
        ? (receiptRow ? [receiptRow] : [])
        : table === "ghost_agency_prospects"
          ? [existingProspect]
          : [],
    }),
    insertRow: async (table, row) => {
      inserts.push({ table, row });
      if (table === "ghost_agency_events") {
        receiptRow = row;
        operations.push("receipt");
      }
      return { mode: "live_write", row: [row] };
    },
    upsertRow: async (table, row, conflict) => {
      writes.push({ table, row, conflict });
      operations.push("prospect");
      return { mode: "live_upsert", row: [row] };
    },
    recordEvent: async (type, payload) => {
      events.push({ type, payload });
      return { mode: "live_write" };
    },
  }, {
    wakeNewestBuildingPracticeBatch: async (...args) => {
      queueWakeCalls += 1;
      operations.push("queue");
      assert.deepEqual(args, [], "the webhook must pass no lead or contact data to the queue wake");
      return { accepted: true, batchId: "batch_opaque_123abc", phase: "run", sequence: 7 };
    },
  });
  global.fetch = async () => {
    throw new Error("receiver must not call Google, Firecrawl, SiteForge, Resend, or any other provider");
  };

  const first = responseCapture();
  const firstStartedAt = Date.now();
  await receiver(requestFor([freshLead]), first);
  const firstElapsed = Date.now() - firstStartedAt;
  assert.ok([200, 202].includes(first.statusCode), first.body);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.sends_performed ?? firstBody.sendsPerformed ?? 0, 0);
  assert.equal(firstBody.builds_started ?? firstBody.buildsStarted ?? 0, 0);
  assert.equal(firstBody.provider_calls, 0);
  assert.equal(firstBody.publishes, 0);
  assert.equal(firstBody.builds_started, 0);
  assert.equal(firstBody.sends, 0);
  assert.deepEqual(firstBody.queue_wake, {
    accepted: true,
    batchId: "batch_opaque_123abc",
    phase: "run",
    sequence: 7,
  });
  assert.deepEqual(operations, ["prospect", "receipt", "queue"], "queue wake must follow both durable writes");
  assert.equal(queueWakeCalls, 1);
  assert.ok(firstElapsed < 1_000, `packet-to-queue wake took ${firstElapsed}ms`);
  assert.equal(inserts.filter((write) => write.table === "ghost_agency_events").length, 1);
  assert.match(inserts[0].row.svix_id, /^leadminer:[a-f0-9]{64}$/);
  assert.equal(inserts[0].row.payload.idempotency_key, headers()["x-leadminer-idempotency-key"]);
  const prospectWrites = writes.filter((write) => write.table === "ghost_agency_prospects");
  assert.equal(prospectWrites.length, 1);
  assert.equal(prospectWrites[0].conflict, "prospect_id");
  assert.deepEqual(
    prospectWrites[0].row.record.truth_packet.mirror_ready.brand_colors,
    freshLead.brand_colors,
    "fresh signed colors must replace stale canonical truth",
  );
  assert.deepEqual(
    prospectWrites[0].row.record.truth_packet.intakeGenie.facts.brand_colors,
    freshLead.brand_colors,
  );
  assert.deepEqual(prospectWrites[0].row.record.truth_packet, prospectWrites[0].row.record.leadminer_truth_packet);
  assert.equal(prospectWrites[0].row.record.source, "historic_import");
  assert.equal(prospectWrites[0].row.record.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(writes.filter((write) => write.table === "ghost_agency_jobs").length, 0);
  assert.equal(events.length, 0, "the atomic svix_id receipt is the ledger; recordEvent is not a replay lock");

  const second = responseCapture();
  await receiver(requestFor([freshLead]), second);
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(JSON.parse(second.body).duplicate, true);
  assert.equal(writes.filter((write) => write.table === "ghost_agency_prospects").length, 1, "a replay must not repeat prospect side effects");
  assert.equal(inserts.length, 1, "a replay must not insert a second receipt");
  assert.equal(events.length, 0);
  assert.equal(queueWakeCalls, 1, "a duplicate receipt must never republish the queue wake");
  assert.equal(JSON.parse(second.body).queue_wake.reason, "duplicate_receipt");

  const mismatched = responseCapture();
  await receiver(requestFor([mirrorReadyLead({ business_name: "Changed payload under same key" })]), mismatched);
  assert.equal(mismatched.statusCode, 409, mismatched.body);
  assert.equal(JSON.parse(mismatched.body).error, "leadminer_idempotency_payload_mismatch");
  assert.equal(writes.filter((write) => write.table === "ghost_agency_prospects").length, 1);
  assert.equal(inserts.length, 1);
  assert.equal(queueWakeCalls, 1);

  const source = fs.readFileSync(path.join(__dirname, "..", "api", "webhooks", "leadminer.js"), "utf8");
  for (const forbidden of [
    /require\(["']\.\.\/\.\.\/lib\/full-run["']\)/,
    /require\(["']\.\.\/\.\.\/lib\/email["']\)/,
    /require\(["']\.\.\/\.\.\/lib\/siteforge["']\)/,
    /require\(["']\.\.\/\.\.\/lib\/mirror-engine/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("queue wake failure stays HTTP 200 and leaves cron as recovery", async () => {
  process.env.GHOST_AGENCY_LEADMINER_WEBHOOK_SECRET = SECRET;
  const receiver = loadReceiver({}, {
    wakeNewestBuildingPracticeBatch: async () => {
      throw new Error("queue transport unavailable");
    },
  });
  global.fetch = async () => {
    throw new Error("queue recovery must not call a provider");
  };

  const response = responseCapture();
  await receiver(requestFor([mirrorReadyLead()]), response);
  assert.equal(response.statusCode, 200, response.body);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.queue_wake, {
    accepted: false,
    recovery: "cron",
    reason: "line_queue_wake_failed",
  });
  assert.deepEqual({
    provider_calls: body.provider_calls,
    builds_started: body.builds_started,
    sends: body.sends,
    publishes: body.publishes,
  }, {
    provider_calls: 0,
    builds_started: 0,
    sends: 0,
    publishes: 0,
  });
});
