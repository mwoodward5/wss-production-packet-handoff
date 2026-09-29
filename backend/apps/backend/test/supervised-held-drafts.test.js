"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { afterEach, test } = require("node:test");
const {
  DRAFT_COUNT,
  HOLD_KEY,
  createHeldDraftQueue,
  phaseOneReleaseEvidence,
} = require("../lib/supervised-held-drafts");
const {
  parseRequestedProspectIds,
  rowsForRequestedIds,
} = require("../api/admin/held-drafts");

const previousHold = process.env.GHOST_AGENCY_REVIEW_HOLD;
afterEach(() => { process.env.GHOST_AGENCY_REVIEW_HOLD = previousHold; });

test("held-draft schema safely makes the legacy preview column nullable", () => {
  const sql = readFileSync(join(__dirname, "..", "supabase", "supervised-held-drafts.sql"), "utf8");
  assert.doesNotMatch(sql, /preview_url\s+text\s+not\s+null/i);
  assert.match(sql, /alter\s+column\s+preview_url\s+drop\s+not\s+null/i);
});

function prospects(count = DRAFT_COUNT) {
  return Array.from({ length: count }, (_, index) => ({
    prospect_id: `prospect-${index + 1}`,
    business_name: `Business ${index + 1}`,
    city: `City ${index + 1}`,
    industry: "landscaping",
    email: `owner${index + 1}@example.test`,
    high_confidence: true,
    getfound_grade: "C",
    opportunity_score: 999999,
  }));
}

function releaseProspects(count = DRAFT_COUNT) {
  return prospects(count).map((prospect, index) => ({
    ...prospect,
    preview_url: `https://previews.wss-ai.com/${index + 1}`,
    report_url: `https://reports.wss-ai.com/${index + 1}`,
    siteforge_renderer: "05-build-v8",
    siteforge_generation_fingerprint: `composition-${index + 1}-v8`,
    siteforge_qc_passed: true,
    siteforge_visual_qc_passed: true,
    siteforge_qc_contract: "public-surface-v2",
    release_evidence: {
      map_gate: { passed: true, evidence: `map-shot-${index + 1}` },
      preview_identity_gate: { passed: true, evidence: `identity-shot-${index + 1}` },
      template_family_gate: {
        passed: true,
        evidence: `template-shot-${index + 1}`,
        actual: "landscaping",
        expected: "landscaping",
      },
    },
  }));
}

function currentSiteForgeReleaseEvidence() {
  return {
    schema: "siteforge-release-evidence-v1",
    map: {
      verified: true,
      qc_check: { name: "release-map-evidence", detail: "verified" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: { size: 4096, sha256: "c".repeat(64) },
      runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
      screenshot_url: "https://previews.wss-ai.com/current/screenshots/desktop/map.png",
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: "Business 1" },
      actual: { business_name: "Business 1", public_packet_business_name: "Business 1", local_business_nodes: 1 },
      public_packet_url: "https://previews.wss-ai.com/current/packet.json",
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: {
        family: "service-map-pins",
        selection: "pinned",
        source: "stage_payload.release_expectation.template_family",
      },
      actual: {
        family: "service-map-pins",
        known_family: true,
        source: "rendered:packet.json#hero_family",
      },
      public_packet_url: "https://previews.wss-ai.com/current/packet.json",
    },
  };
}

function deps(overrides = {}) {
  const auditEvents = [];
  return {
    loadHold: async () => ({ mode: "live_select", rows: [{ hold_key: HOLD_KEY, status: "active" }] }),
    loadExistingDrafts: async () => ({ mode: "live_select", rows: [] }),
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(auditEvents) }),
    isSuppressed: async () => ({ known: true, suppressed: false }),
    compose: async ({ dryRun }) => ({
      ok: true,
      mode: "dry_run",
      composePath: "email.sendSequenceStep",
      subject: "Review draft",
      bodyPreview: dryRun ? "Reply and I'll build a free custom preview with your input. No charge, no obligation." : "",
      htmlPreview: dryRun ? "<!doctype html><html><body>Owner review</body></html>" : "",
    }),
    persistDraft: async () => ({ mode: "live_write" }),
    persistAuditEventBatch: async (rows) => { auditEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
    now: () => "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

test("persists exactly ten dry-run, review-only drafts under an active durable hold", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const persisted = [];
  const events = [];
  const result = await createHeldDraftQueue({ prospects: prospects() }, deps({
    persistDraft: async (draft) => { persisted.push(draft); return { mode: "live_write" }; },
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(events) }),
    persistAuditEventBatch: async (rows) => { events.push(...structuredClone(rows)); return { mode: "live_write" }; },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.count, 10);
  assert.equal(persisted.length, 10);
  assert.equal(events.length, 10);
  assert.ok(persisted.every((draft) => draft.compose_mode === "dry_run" && draft.delivery_status === "review_only"));
  assert.ok(persisted.every((draft) => draft.approval_status === "awaiting_explicit_later_approval"));
  assert.ok(persisted.every((draft) => draft.preview_url === null));
  assert.ok(persisted.every((draft) => draft.getfound_grade === "C"));
  assert.equal(persisted[0].body.includes("999999"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted[0], "html_preview"), false);
  assert.equal(result.artifacts.length, 10);
  assert.ok(result.artifacts.every((artifact) => artifact.compose_path === "email.sendSequenceStep"));
  assert.ok(result.artifacts.every((artifact) => artifact.html_sha256?.length === 64));
  assert.ok(result.artifacts.every((artifact) => !Object.prototype.hasOwnProperty.call(artifact, "release_evidence")));
  assert.ok(events.every((entry) => entry.payload.compose_path === "email.sendSequenceStep"));
  assert.equal(result.sends_performed, 0);
});

test("persists all ten draft rows in one atomic batch when a batch writer is available", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const batches = [];
  const result = await createHeldDraftQueue({ prospects: prospects() }, deps({
    persistDraftBatch: async (rows) => { batches.push(rows); return { mode: "live_write" }; },
  }));
  assert.equal(result.ok, true);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 10);
  assert.equal(new Set(batches[0].map((row) => row.draft_id)).size, 10);
});

test("fails closed if composition restores a retired preview token or prospect artifact URL", async (t) => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  selected[0].preview_url = "https://previews.wss-ai.com/retired-preview";
  for (const [name, bodyPreview, htmlPreview] of [
    ["preview token", "See {{PREVIEW_LINK}}", "<p>Owner review</p>"],
    ["preview URL", `See ${selected[0].preview_url}`, "<p>Owner review</p>"],
    ["preview URL in HTML", "Reply and I will build your preview.", `<a href="${selected[0].preview_url}">Open</a>`],
  ]) {
    await t.test(name, async () => {
      process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
      let writes = 0;
      const result = await createHeldDraftQueue({ prospects: selected }, deps({
        compose: async () => ({
          ok: true,
          mode: "dry_run",
          subject: "Consent review",
          bodyPreview,
          htmlPreview,
        }),
        persistDraftBatch: async () => { writes += 1; return { mode: "live_write" }; },
      }));
      assert.equal(result.ok, false);
      assert.equal(result.reason, "draft_composition_not_consent_first");
      assert.equal(writes, 0);
    });
  }
});

test("an exact persisted batch is an idempotent replay with no compose or write", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  let persistedRows = [];
  const persistedEvents = [];
  const first = await createHeldDraftQueue({ prospects: selected }, deps({
    persistDraftBatch: async (rows) => { persistedRows = structuredClone(rows); return { mode: "live_write" }; },
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(persistedEvents) }),
    persistAuditEventBatch: async (rows) => { persistedEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
  }));
  assert.equal(first.ok, true);
  let composed = 0;
  let writes = 0;
  const replay = await createHeldDraftQueue({ prospects: selected }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: persistedRows }),
    loadAuditEvents: async () => ({ mode: "live_select", rows: persistedEvents }),
    compose: async () => { composed += 1; throw new Error("must not compose on replay"); },
    persistDraftBatch: async () => { writes += 1; return { mode: "live_write" }; },
  }));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.count, 10);
  assert.equal(composed, 0);
  assert.equal(writes, 0);
});

test("an exact replay repairs every missing deterministic audit event before success", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  let persistedRows = [];
  const persistedEvents = [];
  const first = await createHeldDraftQueue({ prospects: selected }, deps({
    persistDraftBatch: async (rows) => { persistedRows = structuredClone(rows); return { mode: "live_write" }; },
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(persistedEvents) }),
    persistAuditEventBatch: async () => ({ mode: "live_write_failed", status: 503 }),
  }));
  assert.equal(first.ok, false);
  assert.equal(first.reason, "draft_event_persistence_failed");
  assert.equal(persistedRows.length, 10);

  let composed = 0;
  const replay = await createHeldDraftQueue({ prospects: selected }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: persistedRows }),
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(persistedEvents) }),
    persistAuditEventBatch: async (rows) => { persistedEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
    compose: async ({ dryRun }) => {
      composed += 1;
      return {
        ok: true,
        mode: "dry_run",
        composePath: "email.sendSequenceStep",
        subject: "Review draft",
        bodyPreview: dryRun ? "Recovered owner review" : "",
        htmlPreview: dryRun ? "<!doctype html><html><body>Recovered owner review</body></html>" : "",
      };
    },
  }));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.audit_events_repaired, 10);
  assert.equal(persistedEvents.length, 10);
  assert.equal(new Set(persistedEvents.map((row) => row.id)).size, 10);
  assert.equal(composed, 10);
});

test("a replay backfills only missing valid events and rejects contradictory event state", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  let persistedRows = [];
  const allEvents = [];
  const first = await createHeldDraftQueue({ prospects: selected }, deps({
    persistDraftBatch: async (rows) => { persistedRows = structuredClone(rows); return { mode: "live_write" }; },
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(allEvents) }),
    persistAuditEventBatch: async (rows) => { allEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
  }));
  assert.equal(first.ok, true);

  const partialEvents = structuredClone(allEvents.slice(0, 3));
  let composed = 0;
  const repaired = await createHeldDraftQueue({ prospects: selected }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: persistedRows }),
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(partialEvents) }),
    persistAuditEventBatch: async (rows) => { partialEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
    compose: async ({ dryRun }) => {
      composed += 1;
      return {
        ok: true,
        mode: "dry_run",
        composePath: "email.sendSequenceStep",
        subject: "Review draft",
        bodyPreview: dryRun ? "Recovered owner review" : "",
        htmlPreview: dryRun ? "<!doctype html><html><body>Recovered owner review</body></html>" : "",
      };
    },
  }));
  assert.equal(repaired.ok, true);
  assert.equal(repaired.audit_events_repaired, 7);
  assert.equal(partialEvents.length, 10);
  assert.equal(composed, 7);

  partialEvents[0].payload.prospect_id = "different-prospect";
  const conflicted = await createHeldDraftQueue({ prospects: selected }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: persistedRows }),
    loadAuditEvents: async () => ({ mode: "live_select", rows: partialEvents }),
  }));
  assert.equal(conflicted.ok, false);
  assert.equal(conflicted.reason, "draft_event_state_conflict");
});

test("a replay fails closed when the post-backfill read cannot verify all ten audit events", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  let persistedRows = [];
  const createdEvents = [];
  const created = await createHeldDraftQueue({ prospects: selected }, deps({
    persistDraftBatch: async (rows) => { persistedRows = structuredClone(rows); return { mode: "live_write" }; },
    loadAuditEvents: async () => ({ mode: "live_select", rows: structuredClone(createdEvents) }),
    persistAuditEventBatch: async (rows) => { createdEvents.push(...structuredClone(rows)); return { mode: "live_write" }; },
  }));
  assert.equal(created.ok, true);

  let reads = 0;
  const replay = await createHeldDraftQueue({ prospects: selected }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: persistedRows }),
    loadAuditEvents: async () => {
      reads += 1;
      return { mode: "live_select", rows: reads === 1 ? [] : structuredClone(createdEvents.slice(0, 9)) };
    },
    persistAuditEventBatch: async () => ({ mode: "live_write" }),
  }));
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "draft_event_verification_failed");
  assert.deepEqual(replay.detail, { verifiedCount: 9 });
});

test("an existing batch must match deterministic draft id and grade and cannot retain a prebuilt preview URL", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const selected = prospects();
  let persistedRows = [];
  const created = await createHeldDraftQueue({ prospects: selected }, deps({
    persistDraftBatch: async (rows) => { persistedRows = structuredClone(rows); return { mode: "live_write" }; },
  }));
  assert.equal(created.ok, true);

  for (const [field, value] of [
    ["draft_id", "00000000-0000-5000-8000-000000000000"],
    ["preview_url", "https://previews.wss-ai.com/wrong-preview"],
    ["getfound_grade", "A"],
  ]) {
    const rows = structuredClone(persistedRows);
    rows[0][field] = value;
    const replay = await createHeldDraftQueue({ prospects: selected }, deps({
      loadExistingDrafts: async () => ({ mode: "live_select", rows }),
    }));
    assert.equal(replay.ok, false, field);
    assert.equal(replay.reason, "held_draft_batch_state_conflict", field);
  }
});

test("a partial persisted batch fails closed before compose or write", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  let composed = 0;
  let writes = 0;
  const result = await createHeldDraftQueue({ prospects: prospects() }, deps({
    loadExistingDrafts: async () => ({ mode: "live_select", rows: [{
      hold_key: HOLD_KEY,
      prospect_id: "prospect-1",
      recipient_email: "owner1@example.test",
      compose_mode: "dry_run",
      delivery_status: "review_only",
      approval_status: "awaiting_explicit_later_approval",
    }] }),
    compose: async () => { composed += 1; throw new Error("must not compose on conflict"); },
    persistDraftBatch: async () => { writes += 1; return { mode: "live_write" }; },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "held_draft_batch_state_conflict");
  assert.deepEqual(result.detail, { existingCount: 1 });
  assert.equal(composed, 0);
  assert.equal(writes, 0);
});

test("fails closed unless both the environment review hold and durable hold are active", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "off";
  assert.equal((await createHeldDraftQueue({ prospects: prospects() }, deps())).reason, "review_hold_not_active");
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  const result = await createHeldDraftQueue({ prospects: prospects() }, deps({ loadHold: async () => ({ mode: "live_select", rows: [] }) }));
  assert.equal(result.reason, "durable_supervised_10_review_pending_hold_required");
});

test("requires exactly one active durable review hold before any compose or persistence", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  for (const rows of [
    [],
    [{ hold_key: HOLD_KEY, status: "inactive" }],
    [
      { hold_key: HOLD_KEY, status: "active" },
      { hold_key: HOLD_KEY, status: "active" },
    ],
    [
      { hold_key: HOLD_KEY, status: "active" },
      { hold_key: HOLD_KEY, status: "inactive" },
    ],
  ]) {
    let composed = 0;
    let persisted = 0;
    const result = await createHeldDraftQueue({ prospects: prospects() }, deps({
      loadHold: async () => ({ mode: "live_select", rows }),
      compose: async () => { composed += 1; throw new Error("must not compose without singular durable hold"); },
      persistDraftBatch: async () => { persisted += 1; return { mode: "live_write" }; },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "durable_supervised_10_review_pending_hold_required");
    assert.equal(composed, 0);
    assert.equal(persisted, 0);
  }
});

test("rejects a suppressed prospect, weak evidence, duplicates, or a non-ten batch before persisting", async () => {
  process.env.GHOST_AGENCY_REVIEW_HOLD = "on";
  let writes = 0;
  const noWrites = deps({ persistDraft: async () => { writes++; return { mode: "live_write" }; } });
  assert.equal((await createHeldDraftQueue({ prospects: prospects(9) }, noWrites)).reason, "requires_exactly_10_prospects");
  const duplicate = prospects(); duplicate[9].email = duplicate[0].email;
  assert.equal((await createHeldDraftQueue({ prospects: duplicate }, noWrites)).reason, "prospects_must_be_unique");
  const weak = prospects(); weak[0].getfound_grade = "";
  assert.equal((await createHeldDraftQueue({ prospects: weak }, noWrites)).reason, "prospect_missing_required_review_evidence");
  assert.equal((await createHeldDraftQueue({ prospects: prospects() }, deps({ ...noWrites, isSuppressed: async () => ({ known: true, suppressed: true }) }))).reason, "suppressed_prospect");
  assert.equal(writes, 0);
});

test("requires and preserves exactly ten explicitly requested prospect IDs", () => {
  const rows = prospects();
  const ids = rows.map((row) => row.prospect_id);
  assert.deepEqual(parseRequestedProspectIds({ prospectIds: ids }), { ids });
  assert.equal(parseRequestedProspectIds({ prospectIds: ids.slice(0, 9) }).error, "requires_exactly_10_unique_prospect_ids");
  assert.equal(parseRequestedProspectIds({ prospectIds: [...ids.slice(0, 9), ids[0]] }).error, "requires_exactly_10_unique_prospect_ids");
  const selected = rowsForRequestedIds([...rows].reverse(), ids);
  assert.deepEqual(selected.missing, []);
  assert.deepEqual(selected.rows.map((row) => row.prospect_id), ids);
});

test("release evidence fails closed on current renderer, artifact, identity, and template-family gaps", () => {
  const valid = releaseProspects(1)[0];
  assert.equal(phaseOneReleaseEvidence(valid).ok, true);

  const stale = { ...valid, siteforge_renderer: "05-build-v7" };
  assert.ok(phaseOneReleaseEvidence(stale).failures.includes("renderer_not_allowed"));

  const wrongFamily = structuredClone(valid);
  wrongFamily.release_evidence.template_family_gate.actual = "tattoo";
  assert.ok(phaseOneReleaseEvidence(wrongFamily).failures.includes("template_family_mismatch"));

  const nestedOnly = structuredClone(valid);
  nestedOnly.preview_url = null;
  nestedOnly.report_url = null;
  nestedOnly.record = {
    preview_url: valid.preview_url,
    report_url: valid.report_url,
  };
  assert.equal(phaseOneReleaseEvidence(nestedOnly).preview_url, valid.preview_url);
  assert.equal(phaseOneReleaseEvidence(nestedOnly).report_url, valid.report_url);
});

test("accepts the current SiteForge release-evidence-v1 shape without weakening legacy support", () => {
  const current = releaseProspects(1)[0];
  current.siteforge_callback = { release_evidence: currentSiteForgeReleaseEvidence() };
  const result = phaseOneReleaseEvidence(current);
  assert.equal(result.ok, true);
  assert.equal(result.map.passed, true);
  assert.equal(result.identity.passed, true);
  assert.deepEqual(
    { actual: result.template_family.actual, expected: result.template_family.expected, passed: result.template_family.passed },
    { actual: "service-map-pins", expected: "service-map-pins", passed: true },
  );

  const legacy = releaseProspects(1)[0];
  assert.equal(phaseOneReleaseEvidence(legacy).ok, true);
});

test("accepts only structured SiteForge advisory waivers while identity stays fail-closed", () => {
  const candidate = releaseProspects(1)[0];
  const evidence = currentSiteForgeReleaseEvidence();
  evidence.map = {
    ...evidence.map,
    verified: false,
    waived: true,
    qc_check: {
      name: "release-map-evidence",
      detail: "advisory: map evidence unverified (waived) — map screenshot, runtime proof, manifest, or supporting map QC is missing or contradictory",
    },
    supporting_checks: [
      { name: "visual-satellite-map-evidence", pass: true, detail: "no confirmed address; satellite map not required" },
      { name: "visual-address-map-directions", pass: true, detail: "no confirmed address; satellite map not required" },
    ],
    manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: false },
  };
  evidence.template_family = {
    verified: true,
    qc_check: {
      name: "release-template-family-match",
      detail: "rendered valid auto-selected template family service-map-pins",
    },
    expected: {
      family: "auto",
      selection: "auto",
      source: "stage_payload.release_expectation.template_family",
    },
    actual: {
      family: "service-map-pins",
      known_family: true,
      source: "rendered:packet.json#hero_family",
    },
  };
  candidate.siteforge_callback = { release_evidence: evidence };
  assert.equal(phaseOneReleaseEvidence(candidate).ok, true);

  const malformedWaiver = structuredClone(candidate);
  malformedWaiver.siteforge_callback.release_evidence.map.qc_check.detail += " forged";
  assert.ok(phaseOneReleaseEvidence(malformedWaiver).failures.includes("map_evidence_missing"));

  const forgedPassingMapWaiver = structuredClone(candidate);
  forgedPassingMapWaiver.siteforge_callback.release_evidence.map.manifest.map_pass = true;
  forgedPassingMapWaiver.siteforge_callback.release_evidence.map.supporting_checks = [
    { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
    { name: "visual-address-map-directions", pass: true, detail: "verified" },
  ];
  assert.ok(phaseOneReleaseEvidence(forgedPassingMapWaiver).failures.includes("map_evidence_missing"));

  const forgedMapPath = structuredClone(candidate);
  forgedMapPath.siteforge_callback.release_evidence.map.evidence_artifact = "screenshots/forged.json";
  assert.ok(phaseOneReleaseEvidence(forgedMapPath).failures.includes("map_evidence_missing"));

  const malformedMapRuntime = structuredClone(candidate);
  malformedMapRuntime.siteforge_callback.release_evidence.map.runtime.unique_colors = "many";
  assert.ok(phaseOneReleaseEvidence(malformedMapRuntime).failures.includes("map_evidence_missing"));

  const waivedIdentity = structuredClone(candidate);
  waivedIdentity.siteforge_callback.release_evidence.identity.verified = false;
  waivedIdentity.siteforge_callback.release_evidence.identity.waived = true;
  assert.ok(phaseOneReleaseEvidence(waivedIdentity).failures.includes("preview_identity_evidence_missing"));
});

test("accepts a canonical unverified family waiver and rejects forged or malformed provenance", () => {
  const candidate = releaseProspects(1)[0];
  const evidence = currentSiteForgeReleaseEvidence();
  evidence.template_family = {
    verified: false,
    waived: true,
    qc_check: {
      name: "release-template-family-match",
      detail: "advisory: template family unverified (waived); expected=auto; rendered=unknown-customer-template",
    },
    expected: {
      family: "auto",
      selection: "auto",
      source: "stage_payload.release_expectation.template_family",
    },
    actual: {
      family: "unknown-customer-template",
      known_family: false,
      source: "rendered:packet.json#hero_family",
    },
  };
  candidate.siteforge_callback = { release_evidence: evidence };
  assert.equal(phaseOneReleaseEvidence(candidate).ok, true);

  const mutations = [
    (waiver) => { waiver.qc_check.detail += " forged"; },
    (waiver) => { waiver.expected.selection = "pinned"; },
    (waiver) => { waiver.expected.source = "user-input"; },
    (waiver) => { waiver.actual.family = "different-family"; },
    (waiver) => { waiver.actual.source = "untrusted-source"; },
    (waiver) => { waiver.actual.known_family = true; },
    (waiver) => { delete waiver.actual.family; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(candidate);
    mutate(forged.siteforge_callback.release_evidence.template_family);
    const result = phaseOneReleaseEvidence(forged);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("template_family_")));
  }
});

test("accepts a verified auto-selected family only with concrete SiteForge selection proof", () => {
  const candidate = releaseProspects(1)[0];
  const evidence = currentSiteForgeReleaseEvidence();
  evidence.template_family = {
    verified: true,
    qc_check: {
      name: "release-template-family-match",
      detail: "rendered valid auto-selected template family service-map-pins",
    },
    expected: {
      family: "auto",
      selection: "auto",
      source: "stage_payload.release_expectation.template_family",
    },
    actual: {
      family: "service-map-pins",
      known_family: true,
      source: "rendered:packet.json#hero_family",
    },
  };
  candidate.siteforge_callback = { release_evidence: evidence };
  assert.equal(phaseOneReleaseEvidence(candidate).ok, true);

  evidence.template_family.actual.known_family = false;
  assert.ok(phaseOneReleaseEvidence(candidate).failures.includes("template_family_mismatch"));
});

test("current SiteForge evidence fails closed when required fields are missing, false, or contradictory", async (t) => {
  const cases = [
    ["wrong schema", (evidence) => { evidence.schema = "siteforge-release-evidence-v0"; }, "release_evidence_schema_not_allowed"],
    ["map not verified", (evidence) => { evidence.map.verified = false; }, "map_evidence_missing"],
    ["map runtime proof missing", (evidence) => { delete evidence.map.runtime; }, "map_evidence_missing"],
    ["map supporting check false", (evidence) => { evidence.map.supporting_checks[0].pass = false; }, "map_evidence_missing"],
    ["identity not verified", (evidence) => { evidence.identity.verified = false; }, "preview_identity_evidence_missing"],
    ["identity packet name missing", (evidence) => { delete evidence.identity.actual.public_packet_business_name; }, "preview_identity_evidence_missing"],
    ["identity contradiction", (evidence) => { evidence.identity.actual.business_name = "Different Business"; }, "preview_identity_evidence_missing"],
    ["template family not verified", (evidence) => { evidence.template_family.verified = false; }, "template_family_evidence_missing"],
    ["template family missing", (evidence) => { delete evidence.template_family.actual.family; }, "template_family_evidence_missing"],
    ["template family contradiction", (evidence) => { evidence.template_family.actual.family = "editorial-split"; }, "template_family_mismatch"],
  ];
  for (const [name, mutate, failure] of cases) {
    await t.test(name, () => {
      const candidate = releaseProspects(1)[0];
      candidate.siteforge_callback = { release_evidence: currentSiteForgeReleaseEvidence() };
      mutate(candidate.siteforge_callback.release_evidence);
      const result = phaseOneReleaseEvidence(candidate);
      assert.equal(result.ok, false);
      assert.ok(result.failures.includes(failure), `${name}: ${result.failures.join(",")}`);
    });
  }
});
