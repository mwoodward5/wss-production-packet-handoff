"use strict";

/**
 * test/line-packet-honest-failure.test.js — the Rocky's Plumbing incident,
 * 2026-08-09, as a contract.
 *
 * Ten console runs of "LeadMiner packets — all trades" picked the SAME one row
 * and each died as "mirror produced no host-approved preview URL". Reproduced
 * against the stored row: the packet was complete and valid except that its
 * logo URL was plain http:// (the classic WP pattern — the https page embeds
 * assets from the host's http origin), which failed the mirror-request schema
 * as a 400 invalid_request. The refusal payload naming that exact field was
 * captured by the onRefusal side channel and then thrown away, because the
 * blocked dispatch shape a packet refusal returns is TRUTHY and only the
 * null-path read the payload. Nothing stamped the failure, so every following
 * run re-picked the same row.
 *
 * Four laws, each measured here:
 *   1. an http:// packet logo is upgraded to the same asset over TLS and the
 *      build proceeds — the engine's TLS-only fetch still decides;
 *   2. a truthy dispatch with no usable URL names WHAT came back, never the
 *      bare host-approved string;
 *   3. a failed packet build is stamped on the record, and the pick skips
 *      stamped rows inside the retry window — counted, not silent;
 *   4. short supply says so, with true arithmetic, on the funnel the batches
 *      panel already renders.
 */

const test = require("node:test");
const assert = require("node:assert");

const {
  pickProspects,
  mirrorProspect,
  describeRefusal,
  sourceFactsFor,
  BUILD_RETRY_WINDOW_MS,
} = require("../lib/line-adapters");
const {
  buildMirrorForProspect,
  leadMinerMirrorInput,
  httpsAssetUrl,
} = require("../lib/mirror-lane-build");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

// ---------------------------------------------------------------------------
// A complete, provenanced packet in the exact shape the LeadMiner webhook
// stores — the Rocky's Plumbing anatomy, minus nothing that matters.
// ---------------------------------------------------------------------------
function rockyPacket() {
  const provenance = {};
  const stamp = (pointer, kind = "site_scrape") => {
    provenance[pointer] = {
      source: kind === "google_places_api"
        ? "https://places.googleapis.com/v1/places/ChIJ3zQ5b65DYIgR-eIitJQvyA8"
        : "https://rockys.plumbing/",
      captured_at: "2026-08-08T18:00:38.258Z",
      source_kind: kind,
    };
  };
  stamp("/business_name", "google_places_api");
  stamp("/place_id", "google_places_api");
  stamp("/phone_e164", "google_places_api");
  stamp("/industry");
  stamp("/city");
  stamp("/state");
  stamp("/logo_url");
  stamp("/logo_source_url");
  stamp("/website_url");
  stamp("/photos/0/url");
  stamp("/photos/0/source");
  stamp("/services/0/name");
  stamp("/services/1/name");
  stamp("/brand_colors/accent");
  stamp("/brand_colors/primary");
  return {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Rocky's Plumbing",
      place_id: "ChIJ3zQ5b65DYIgR-eIitJQvyA8",
      industry: "plumber",
      city: "Chickamauga",
      state: "GA",
      phone_e164: "+17068413132",
      website_url: "https://rockys.plumbing/",
      // THE INCIDENT: the mark lives on the host's plain-http origin.
      logo_url: "http://rockysplumbing.wpengine.com/wp-content/uploads/2021/01/Rockys-Plumbing-logo-2-white.png",
      logo_source_url: "https://rockys.plumbing/",
      photos: [{ url: "https://rockys.plumbing/wp-content/uploads/2021/01/Rockys-Plumbing-logo-2.png", source: "own_site" }],
      // Raw scraped markdown, as the harvester actually writes it.
      services: [
        { name: "- [Request Plumbing Service – Chickamauga](https://rockys.plumbing/request-service/)" },
        { name: "## Available for **24/7 Emergency** Service" },
      ],
      brand_colors: { accent: "#DD1515", primary: "#00A1E0" },
      provenance,
    },
  };
}

function packetRow(id, extra = {}, recordExtra = {}) {
  return {
    prospect_id: id,
    business_name: "Rocky's Plumbing",
    city: "Chickamauga",
    state: "GA",
    email: "garnerrocky1980@gmail.com",
    status: "held",
    preview_url: "",
    updated_at: "2026-08-09T18:01:49.659+00:00",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: true,
      truth_packet: rockyPacket(),
      truth_packet_source: "leadminer_mirror_ready",
      ...recordExtra,
    },
    ...extra,
  };
}

// The truthy fail-closed shape dispatchMirrorLane returns for a refused
// packet build — blockedLeadMinerMirrorDispatch, verbatim.
function blockedShape(reason, detail = []) {
  return {
    mode: "mirror_lane",
    pending: false,
    fail_closed: true,
    blocked: [reason],
    urls: {},
    buildStatus: {
      ready: false,
      renderer: "mirror-engine",
      required_renderer: "mirror-engine",
      qc_passed: false,
      visual_qc_passed: false,
      blocked: [reason],
      detail,
    },
  };
}

const AJV_DETAIL = [{ path: "/brand/logo", keyword: "pattern", message: 'must match pattern "^https://"' }];

// ---------------------------------------------------------------------------
// 1. THE VERDICT: the packet CAN build — the http logo is a transport defect,
//    not a fact defect. Same host, same path, TLS; the schema passes.
// ---------------------------------------------------------------------------

test("httpsAssetUrl upgrades transport and refuses anything that is not http(s)", () => {
  assert.equal(httpsAssetUrl("http://host.example/a/logo.png"), "https://host.example/a/logo.png");
  assert.equal(httpsAssetUrl("https://host.example/a/logo.png"), "https://host.example/a/logo.png");
  assert.equal(httpsAssetUrl("HTTP://host.example/x.png"), "https://host.example/x.png");
  assert.equal(httpsAssetUrl("data:image/png;base64,xxxx"), "");
  assert.equal(httpsAssetUrl("//host.example/x.png"), "");
  assert.equal(httpsAssetUrl(""), "");
});

test("an http:// packet logo is carried as the same asset over TLS, not refused and not left to 400", () => {
  const input = leadMinerMirrorInput(rockyPacket());
  assert.equal(input.ok, true, JSON.stringify(input));
  assert.equal(
    input.brand.logo,
    "https://rockysplumbing.wpengine.com/wp-content/uploads/2021/01/Rockys-Plumbing-logo-2-white.png",
  );
});

test("the Rocky packet's build request passes the mirror-request schema end to end", async () => {
  let captured = null;
  const out = await buildMirrorForProspect(
    {
      prospect_id: "place_rocky",
      business_name: "Rocky's Plumbing",
      truth_packet: rockyPacket(),
      truth_packet_source: "leadminer_mirror_ready",
    },
    {
      dryRun: true,
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        captureFonts: async () => ({ ok: false }),
        readFleetIdentities: async () => ({ ok: true, identities: [] }),
        mirror: async (request) => {
          captured = request;
          const verdict = checkMirrorRequest(request);
          if (!verdict.ok) return { status: verdict.status, body: verdict.body };
          return { status: 200, body: { ok: true, revealable: false, preview_url: "", checks: {} } };
        },
      },
    },
  );
  assert.ok(captured, "the build must reach the engine");
  const schemaVerdict = checkMirrorRequest(captured);
  assert.equal(schemaVerdict.ok, true, JSON.stringify(schemaVerdict.ok ? null : schemaVerdict.body));
  assert.equal(out.ok, true, JSON.stringify({ reason: out.reason, detail: out.detail }));
  assert.match(captured.brand.logo, /^https:\/\/rockysplumbing\.wpengine\.com\//);
  // The raw scraped markdown never reaches the site: link syntax, headings and
  // emphasis are stripped to the words a human wrote.
  for (const service of captured.content.services) {
    assert.doesNotMatch(service.name, /[[\]#*]|https?:\/\//, `markdown leaked into a service name: ${service.name}`);
  }
});

test("a packet build that fails carries the engine's field-level detail outward", async () => {
  const out = await buildMirrorForProspect(
    {
      prospect_id: "place_rocky",
      business_name: "Rocky's Plumbing",
      truth_packet: rockyPacket(),
      truth_packet_source: "leadminer_mirror_ready",
    },
    {
      dryRun: true,
      deps: {
        resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
        captureFonts: async () => ({ ok: false }),
        readFleetIdentities: async () => ({ ok: true, identities: [] }),
        mirror: async () => ({ status: 400, body: { ok: false, error: "invalid_request", detail: AJV_DETAIL } }),
      },
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "invalid_request");
  assert.deepEqual(out.detail, AJV_DETAIL, "body.detail must ride out of the build, not be dropped");
});

// ---------------------------------------------------------------------------
// 2. NAME EVERY CASUALTY — a truthy dispatch with no usable URL must say what
//    came back.
// ---------------------------------------------------------------------------

test("describeRefusal prints reason, status and the ajv field detail as words", () => {
  const named = describeRefusal({ reason: "invalid_request", status: 400, detail: AJV_DETAIL });
  assert.match(named, /invalid_request \(status 400\)/);
  assert.match(named, /\/brand\/logo: must match pattern/);
  // The historical contracts hold unchanged.
  assert.equal(describeRefusal(null), "mirror_build_not_revealable");
  const gates = describeRefusal({
    reason: "not_revealable",
    detail: ["render=failed"],
    cause: { render: "hero_video_not_playing" },
  });
  assert.match(gates, /render=failed/);
  assert.match(gates, /hero_video_not_playing/);
});

test("a blocked packet dispatch names its cause on the row instead of the bare host-approved string", async () => {
  const row = packetRow("place_rocky");
  const writes = [];
  const out = await mirrorProspect(
    { prospectId: "place_rocky" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
      dispatchMirrorLane: async (prospect, opts) => {
        // dispatchMirrorLane fires the side channel on its way to the blocked
        // shape — exactly what production did on 2026-08-09.
        opts.onRefusal({ reason: "invalid_request", detail: AJV_DETAIL, status: 400, leadMinerPacket: true });
        return blockedShape("invalid_request");
      },
    },
  );
  assert.equal(out.ok, false);
  assert.notEqual(out.reason, "mirror produced no host-approved preview URL");
  assert.match(out.reason, /invalid_request \(status 400\)/);
  assert.match(out.reason, /\/brand\/logo/);
});

test("a blocked dispatch whose side channel never fired still reads the cause off the shape", async () => {
  const row = packetRow("place_rocky");
  const out = await mirrorProspect(
    { prospectId: "place_rocky" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async () => ({ ok: true, updated: true }),
      dispatchMirrorLane: async () => blockedShape("leadminer_mirror_not_revealable", ["render=failed"]),
    },
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /leadminer_mirror_not_revealable/);
  assert.match(out.reason, /render=failed/);
});

test("a Mirror fleet outage stays retryable and never stamps the lead as failed", async () => {
  const row = packetRow("place_fleet_hold");
  const writes = [];
  const out = await mirrorProspect(
    { prospectId: "place_fleet_hold" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
      dispatchMirrorLane: async () => ({
        mode: "mirror_lane_system_hold",
        pending: true,
        fail_closed: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        reason: "mirror_fleet_read_unavailable",
        system_hold: {
          schema: "wss.mirror.system_hold.v1",
          type: "system",
          code: "mirror_fleet_read_unavailable",
          retryable: true,
          scope: "mirror_build",
        },
        urls: {},
        buildStatus: { pending: true, detail: [{ reason: "fleet_read_not_ok" }] },
      }),
    },
  );

  assert.equal(out.ok, false);
  assert.equal(out.retryable, true);
  assert.equal(out.disposition, "system_hold");
  assert.equal(out.lead_rejection, false);
  assert.equal(out.reason, "mirror_fleet_read_unavailable");
  assert.equal(out.dispatchFailure.beforeBuild, true);
  assert.equal(out.dispatchFailure.hasDurableBuildIdentity, false);
  assert.equal(out.dispatchFailure.rebuild_allowed, true);
  assert.equal(writes.length, 0, "system holds are not lead failure stamps");
});

test("a post-deploy fleet-record hold carries exact reconciliation evidence and forbids a Line rebuild", async () => {
  const row = packetRow("place_fleet_record_hold");
  const buildHash = "d".repeat(64);
  const previewUrl = "https://fleet-record-hold.wss-ai.com/";
  const releaseEvidence = {
    schema: "mirror-engine-release-v1",
    build_hash: buildHash,
    preview_url: previewUrl,
    evidence_sha: "e".repeat(64),
    proofIdentity: {
      site_id: "site-fleet-record-hold",
      release_id: "release-fleet-record-hold",
      build_hash: buildHash,
    },
  };
  const reconciliation = {
    schema: "wss.mirror.fleet_reconciliation.v1",
    action: "record_fleet_identity",
    release: {
      build_hash: buildHash,
      preview_url: previewUrl,
      deploy_id: "dpl_fleet_record_hold",
      deploy_url: "https://fleet-record-hold.vercel.app/",
      evidence_sha: releaseEvidence.evidence_sha,
      proof_identity: releaseEvidence.proofIdentity,
    },
    fleet_identity: {
      slug: "fleet-record-hold",
      h1: "Fleet Record Hold",
      title: "Fleet Record Hold",
      prospect_id: "place_fleet_record_hold",
      donor: "plumbing-premium-donor",
      build_hash: buildHash,
      attempt: 1,
    },
  };
  const out = await mirrorProspect(
    { prospectId: "place_fleet_record_hold" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async () => {
        throw new Error("a system hold must not stamp a lead failure");
      },
      dispatchMirrorLane: async () => ({
        mode: "mirror_lane_system_hold",
        pending: true,
        fail_closed: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        reason: "mirror_fleet_record_unavailable",
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
    },
  );

  assert.equal(out.ok, false);
  assert.equal(out.retryable, false, "manual reconciliation is not permission to rebuild");
  assert.equal(out.disposition, "system_hold");
  assert.equal(out.lead_rejection, false);
  assert.equal(out.provider_attempted, true);
  assert.equal(out.manual_reconciliation_required, true);
  assert.equal(out.rebuild_allowed, false);
  assert.equal(out.dispatchFailure.beforeBuild, false);
  assert.equal(out.dispatchFailure.hasDurableBuildIdentity, true);
  assert.equal(out.dispatchFailure.rebuild_allowed, false);
  assert.deepEqual(out.reconciliation, reconciliation);
  assert.deepEqual(out.releaseEvidence, releaseEvidence);
  assert.equal(out.previewUrl, previewUrl);
  assert.equal(out.buildHash, buildHash);
});

test("a preview URL the host guard refuses is named, with the URL", async () => {
  const row = packetRow("place_rocky");
  const out = await mirrorProspect(
    { prospectId: "place_rocky" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async () => ({ ok: true, updated: true }),
      dispatchMirrorLane: async () => ({ mode: "mirror_lane", urls: { preview_url: "https://not-our-host.example.com/" } }),
    },
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /host guard refused: https:\/\/not-our-host\.example\.com/);
});

// ---------------------------------------------------------------------------
// 3. BREAK THE LOOP — the failure is stamped, and the pick sits stamped rows
//    out for the retry window.
// ---------------------------------------------------------------------------

test("a failed packet build stamps last_build_error on the record, version-guarded", async () => {
  const row = packetRow("place_rocky");
  const writes = [];
  await mirrorProspect(
    { prospectId: "place_rocky" },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [row] }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async (table, idColumn, idValue, guards, patch) => {
        writes.push({ table, idColumn, idValue, guards, patch });
        return { ok: true, updated: true };
      },
      dispatchMirrorLane: async (prospect, opts) => {
        opts.onRefusal({ reason: "invalid_request", detail: AJV_DETAIL, status: 400, leadMinerPacket: true });
        return blockedShape("invalid_request");
      },
    },
  );
  assert.equal(writes.length, 1, "exactly one stamp write");
  const write = writes[0];
  assert.equal(write.table, "ghost_agency_prospects");
  assert.equal(write.idValue, "place_rocky");
  assert.equal(write.guards.updated_at, `eq.${row.updated_at}`, "the stamp must be version-guarded");
  const stampValue = write.patch.record.last_build_error;
  assert.match(stampValue.reason, /invalid_request/);
  assert.ok(Number.isFinite(Date.parse(stampValue.at)), "the stamp carries a real timestamp");
  // The rest of the record survives the stamp untouched.
  assert.equal(write.patch.record.truth_packet_source, "leadminer_mirror_ready");
});

test("a non-packet row is never stamped — the loop breaker is scoped to the packet shelf", async () => {
  const writes = [];
  const out = await mirrorProspect(
    { prospectId: "plain-row" },
    {
      lane: "sandbox",
      select: async () => ({
        ok: true,
        data: [{ prospect_id: "plain-row", status: "held", updated_at: "2026-08-09T00:00:00.000Z", record: {} }],
      }),
      mirrorLaneEnabled: () => true,
      conditionalUpdate: async (...args) => { writes.push(args); return { ok: true, updated: true }; },
      dispatchMirrorLane: async () => { throw new Error("must not dispatch"); },
    },
  );
  assert.equal(out.ok, false, "a non-packet row without a contract still fails the contract gate");
  assert.equal(writes.length, 0, "no stamp for rows the packet pick never touches");
});

test("the pick skips a packet that failed inside the retry window, counts it, and retries after", async () => {
  const NOW = Date.parse("2026-08-10T00:00:00.000Z");
  const burned = packetRow("place_burned", {}, {
    last_build_error: { reason: "invalid_request (status 400)", at: new Date(NOW - 60 * 60 * 1000).toISOString() },
  });
  const fresh = packetRow("place_fresh");
  fresh.business_name = "Fresh Flow Plumbing";
  fresh.record.truth_packet.mirror_ready.business_name = "Fresh Flow Plumbing";

  const picked = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({ ok: true, data: [burned, fresh] }),
      clock: () => NOW,
    },
  );
  assert.deepEqual(picked.map((r) => r.prospectId), ["place_fresh"]);
  const shelfStage = picked.funnel[0];
  assert.equal(shelfStage.entered, 2);
  assert.equal(shelfStage.survived, 1);
  const skipReason = Object.keys(shelfStage.rejected).find((k) => /failed a build/.test(k));
  assert.ok(skipReason, `the skip must be counted by name, got: ${JSON.stringify(shelfStage.rejected)}`);
  assert.equal(shelfStage.rejected[skipReason], 1);

  // Outside the window the same row is eligible again — a stamp is a pause,
  // not a tombstone.
  const later = await pickProspects(
    { target: "leadminer", count: 10 },
    {
      select: async () => ({ ok: true, data: [burned, fresh] }),
      clock: () => NOW + BUILD_RETRY_WINDOW_MS + 1000,
    },
  );
  assert.deepEqual(later.map((r) => r.prospectId).sort(), ["place_burned", "place_fresh"]);
});

// ---------------------------------------------------------------------------
// 4. HONEST EMPTY SUPPLY — short is said out loud, with true numbers, on the
//    funnel the batches panel renders.
// ---------------------------------------------------------------------------

test("a short shelf states requested vs picked and where fresh supply comes from", async () => {
  const picked = await pickProspects(
    { target: "leadminer", count: 10 },
    { select: async () => ({ ok: true, data: [packetRow("place_only")] }) },
  );
  assert.equal(picked.length, 1);
  const demand = picked.funnel[1];
  assert.equal(demand.entered, 10, "entered is the requested count");
  assert.equal(demand.survived, 1, "survived is what the shelf could actually fill");
  const [sentence] = Object.keys(demand.rejected);
  assert.match(sentence, /packet shelf exhausted/);
  assert.match(sentence, /LeadMiner exports/);
  assert.equal(demand.rejected[sentence], 9, "the shortfall count must be the true arithmetic");
});

test("a full shelf reports no shortfall", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => {
    const row = packetRow(`place_${i}`);
    row.business_name = `Rocky's Plumbing ${i}`;
    return row;
  });
  const picked = await pickProspects(
    { target: "leadminer", count: 2 },
    { select: async () => ({ ok: true, data: rows }) },
  );
  assert.equal(picked.length, 2);
  const demand = picked.funnel[1];
  assert.equal(demand.entered, 2);
  assert.equal(demand.survived, 2);
  assert.deepEqual(demand.rejected, {});
});

test("a shelf that cannot be read is a failed pick, not an empty shelf", async () => {
  await assert.rejects(
    pickProspects(
      { target: "leadminer", count: 10 },
      { select: async () => ({ ok: false, error: "store_unreachable" }) },
    ),
    /packet_shelf_read_failed/,
  );
});

// ---------------------------------------------------------------------------
// 5. THE GATE'S REFERENCE — the label is a hint, the services are the
//    evidence, for ALL THREE readers. M & M Heating & Cooling (label
//    "plumber", services all air conditioning) built correctly as hvac and
//    was then refused by vertical_match as "foreign trade language on a
//    plumbing mirror", because sourceFactsFor handed the gate the raw label.
//    Measured live on batch line_msm8rq4w_96090128, 2026-08-09.
// ---------------------------------------------------------------------------

test("the gate's reference vertical is derived from the packet's services, not its label", async () => {
  const packet = rockyPacket();
  packet.mirror_ready.business_name = "M & M Heating & Cooling, LLC";
  packet.mirror_ready.industry = "plumber"; // the label that lies
  packet.mirror_ready.services = [
    { name: "AC Maintenance/Repair Services" },
    { name: "Air Conditioner Installation" },
    { name: "Furnace Repair" },
  ];
  // No logo on this fixture: sourceFactsFor hashes a packet logo over the
  // network, and this test's contract is the vertical only.
  packet.mirror_ready.logo_url = "";
  const row = packetRow("place_mm");
  row.record.truth_packet = packet;

  const facts = await sourceFactsFor(
    { prospectId: "place_mm", businessName: "M & M Heating & Cooling, LLC", vertical: "hvac" },
    { select: async () => ({ ok: true, data: [row] }) },
  );
  assert.equal(facts.vertical, "hvac", `the gate must be told the services' trade, got: ${facts.vertical}`);
});
