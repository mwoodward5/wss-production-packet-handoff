"use strict";

// This is deliberately a review artifact queue, never a delivery queue.
// Keep send, approve, build, call, and SMS behavior out of this module.

const { createHash } = require("node:crypto");
const { reviewHoldActive } = require("./email");
const { REQUIRED_QC_CONTRACT, REQUIRED_RENDERER } = require("./siteforge");
const { insertRow, select } = require("./store");
// The one place the STOP promise is written. A review draft is a preview of a
// real cold email, so it owes the reader the identical opt-out sentence — and a
// draft whose footer had drifted from the sending path would be reviewed as if
// it were what ships. See lib/opt-out-promise.js.
const { OPT_OUT_PROMISE } = require("./opt-out-promise");

const HOLD_KEY = "supervised_10_review_pending";
const DRAFT_COUNT = 10;

function value(record = {}, names = []) {
  for (const name of names) {
    const found = record?.[name] ?? record?.record?.[name];
    if (found !== undefined && found !== null && String(found).trim()) return found;
  }
  return "";
}

function prospectId(prospect = {}) {
  return String(value(prospect, ["prospect_id", "prospectId", "id"])).trim();
}

function emailOf(prospect = {}) {
  return String(value(prospect, ["email", "owner_email", "ownerEmail"])).trim().toLowerCase();
}

function deterministicDraftId(prospect = {}) {
  const digest = createHash("sha256")
    .update(`${HOLD_KEY}|${prospectId(prospect)}|${emailOf(prospect)}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicAuditEventId(draftId = "") {
  const digest = createHash("sha256")
    .update(`${HOLD_KEY}|audit_event|${String(draftId).trim()}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const hex = digest.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getFoundGrade(prospect = {}) {
  // Intentionally do not fall back to opportunity score or any generic score.
  const grade = prospect.getfound_grade
    ?? prospect.getFoundGrade
    ?? prospect.getfound?.grade
    ?? prospect.record?.getfound_grade
    ?? prospect.record?.getFoundGrade
    ?? prospect.record?.getfound?.grade;
  return typeof grade === "string" && grade.trim() ? grade.trim().toUpperCase() : "";
}

function highConfidence(prospect = {}) {
  const direct = prospect.high_confidence ?? prospect.highConfidence ?? prospect.record?.high_confidence ?? prospect.record?.highConfidence;
  if (direct === true) return true;
  const confidence = Number(prospect.confidence ?? prospect.record?.confidence);
  return Number.isFinite(confidence) && confidence >= 0.8;
}

function validPreview(prospect = {}) {
  return publicHttpsArtifact(prospect, ["preview_url", "previewUrl"]);
}

function nestedSources(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const callback = prospect.siteforge_callback && typeof prospect.siteforge_callback === "object"
    ? prospect.siteforge_callback
    : record.siteforge_callback && typeof record.siteforge_callback === "object"
      ? record.siteforge_callback
      : {};
  const dispatch = prospect.build_dispatch && typeof prospect.build_dispatch === "object"
    ? prospect.build_dispatch
    : record.build_dispatch && typeof record.build_dispatch === "object"
      ? record.build_dispatch
      : {};
  const roots = [prospect, record, callback, dispatch];
  const evidenceKeys = [
    "phase_one_evidence",
    "phaseOneEvidence",
    "release_evidence",
    "releaseEvidence",
    "release_gates",
    "releaseGates",
    "qc_evidence",
    "qcEvidence",
    "public_surface_evidence",
    "publicSurfaceEvidence",
  ];
  const sources = [...roots];
  for (const root of roots) {
    for (const key of evidenceKeys) {
      if (root?.[key] && typeof root[key] === "object") sources.push(root[key]);
    }
  }
  return [...new Set(sources)];
}

function firstPresent(sources, names) {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(source, name)) {
        const found = source[name];
        if (found !== undefined && found !== null && (typeof found !== "string" || found.trim())) return found;
      }
    }
  }
  return undefined;
}

function positiveGate(input) {
  return input === true || input === 1 || /^(true|yes|ok|pass|passed|ready|cleared|verified)$/i.test(String(input || "").trim());
}

function publicHttpsUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    const host = url.hostname.toLowerCase();
    const blockedHost = !host
      || host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".test")
      || host.endsWith(".example")
      || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return url.protocol === "https:" && !url.username && !url.password && !blockedHost ? url.toString() : "";
  } catch {
    return "";
  }
}

function publicHttpsArtifact(prospect = {}, names = []) {
  const found = firstPresent(nestedSources(prospect), names);
  return publicHttpsUrl(found);
}

function proofObject(sources, names) {
  const found = firstPresent(sources, names);
  return found && typeof found === "object" && !Array.isArray(found) ? found : null;
}

function hasEvidence(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" ? Boolean(value.trim()) : Number.isFinite(value);
}

function explicitProof(sources, config) {
  const object = proofObject(sources, config.objectNames || []);
  const passValue = object
    ? firstPresent([object], ["passed", "ok", "verified", "present", "matched", "ready"])
    : firstPresent(sources, config.passNames || []);
  const evidence = object
    ? firstPresent([object], ["evidence", "proof", "url", "screenshot_url", "screenshotUrl", "details", "checks", "source"])
    : firstPresent(sources, config.evidenceNames || []);
  const objectHasSubstance = object
    ? Object.keys(object).some((key) => !["passed", "ok", "verified", "present", "matched", "ready"].includes(key))
    : false;
  return {
    passed: positiveGate(passValue) && (hasEvidence(evidence) || objectHasSubstance),
    evidence: hasEvidence(evidence) ? evidence : null,
  };
}

function normalizedFamily(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function releaseIdentityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") || "";
}

function releaseEvidenceEnvelope(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const callback = prospect.siteforge_callback && typeof prospect.siteforge_callback === "object"
    ? prospect.siteforge_callback
    : record.siteforge_callback && typeof record.siteforge_callback === "object"
      ? record.siteforge_callback
      : {};
  const dispatch = prospect.build_dispatch && typeof prospect.build_dispatch === "object"
    ? prospect.build_dispatch
    : record.build_dispatch && typeof record.build_dispatch === "object"
      ? record.build_dispatch
      : {};
  let legacyEvidence = null;
  for (const source of [prospect, record, callback, dispatch]) {
    const evidence = source.release_evidence ?? source.releaseEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) continue;
    if (Object.prototype.hasOwnProperty.call(evidence, "schema")) return evidence;
    if (!legacyEvidence) legacyEvidence = evidence;
  }
  return legacyEvidence;
}

const SITEFORGE_MAP_WAIVER_DETAIL = "advisory: map evidence unverified (waived) — map screenshot, runtime proof, manifest, or supporting map QC is missing or contradictory";
const SITEFORGE_FAMILY_EXPECTATION_SOURCE = "stage_payload.release_expectation.template_family";
const SITEFORGE_FAMILY_RENDER_SOURCE = "rendered:packet.json#hero_family";

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function canonicalMapWaiver(map, supportingChecks) {
  if (
    map.waived !== true
    || map.verified !== false
    || map.qc_check?.name !== "release-map-evidence"
    || map.qc_check?.detail !== SITEFORGE_MAP_WAIVER_DETAIL
    || map.artifact !== "screenshots/desktop/map.png"
    || map.evidence_artifact !== "screenshots/map-evidence.json"
    || map.manifest_artifact !== "screenshots/manifest.json"
    || !hasOwn(map, "screenshot")
    || !hasOwn(map, "runtime")
    || !hasOwn(map, "manifest")
    || !Array.isArray(map.supporting_checks)
    || map.supporting_checks.length !== 2
    || supportingChecks.size !== 2
  ) return false;

  const requiredChecks = ["visual-satellite-map-evidence", "visual-address-map-directions"];
  if (!requiredChecks.every((name) => {
    const check = supportingChecks.get(name);
    return Boolean(
      check
      && typeof check.pass === "boolean"
      && typeof check.detail === "string"
      && check.detail.trim(),
    );
  })) return false;

  const screenshot = map.screenshot;
  const screenshotValid = Boolean(
    screenshot
    && typeof screenshot === "object"
    && !Array.isArray(screenshot)
    && Number(screenshot.size || 0) > 64
    && /^[a-f0-9]{64}$/.test(String(screenshot.sha256 || "")),
  );
  if (screenshot !== null && !screenshotValid) return false;

  const runtime = map.runtime;
  const runtimeShapeValid = Boolean(
    runtime
    && typeof runtime === "object"
    && !Array.isArray(runtime)
    && typeof runtime.response_ok === "boolean"
    && typeof runtime.geometry_ok === "boolean"
    && typeof runtime.pixels_ok === "boolean"
    && Number.isFinite(Number(runtime.unique_colors))
    && Number(runtime.unique_colors) >= 0
    && Number.isFinite(Number(runtime.variance))
    && Number(runtime.variance) >= 0,
  );
  if (runtime !== null && !runtimeShapeValid) return false;
  const runtimeValid = Boolean(
    runtimeShapeValid
    && runtime.response_ok === true
    && runtime.geometry_ok === true
    && runtime.pixels_ok === true
    && Number(runtime.unique_colors) >= 16
    && Number(runtime.variance) >= 80,
  );

  const manifest = map.manifest;
  const manifestShapeValid = Boolean(
    manifest
    && typeof manifest === "object"
    && !Array.isArray(manifest)
    && manifest.schema === "siteforge-screenshot-manifest-v1"
    && typeof manifest.map_pass === "boolean",
  );
  if (manifest !== null && !manifestShapeValid) return false;
  const manifestValid = Boolean(manifestShapeValid && manifest.map_pass === true);
  const supportingChecksValid = requiredChecks.every((name) => {
    const check = supportingChecks.get(name);
    return check.pass === true && !/not required/i.test(check.detail);
  });

  // A waiver must preserve the real reason it was emitted. A fully passing map
  // relabeled as waived is forged evidence, not an advisory SiteForge result.
  return !(screenshotValid && runtimeValid && manifestValid && supportingChecksValid);
}

function canonicalFamilyWaiver(family, expectedFamily, actualFamily) {
  const expectedSelection = expectedFamily === "auto" ? "auto" : "pinned";
  const expectedDetail = `advisory: template family unverified (waived); expected=${expectedFamily}; rendered=${actualFamily}`;
  const provenanceValid = Boolean(
    expectedFamily
    && actualFamily
    && family.expected?.selection === expectedSelection
    && family.expected?.source === SITEFORGE_FAMILY_EXPECTATION_SOURCE
    && typeof family.actual?.known_family === "boolean"
    && family.actual?.source === SITEFORGE_FAMILY_RENDER_SOURCE
  );
  const genuinelyUnverified = Boolean(
    family.actual?.known_family !== true
    || (expectedFamily !== "auto" && expectedFamily !== actualFamily)
  );
  return Boolean(
    family.waived === true
    && family.verified === false
    && family.qc_check?.name === "release-template-family-match"
    && family.qc_check?.detail === expectedDetail
    && provenanceValid
    && genuinelyUnverified
  );
}

function currentSiteForgeEvidence(prospect = {}) {
  const envelope = releaseEvidenceEnvelope(prospect);
  if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, "schema")) return null;
  const map = envelope.map && typeof envelope.map === "object" ? envelope.map : {};
  const identity = envelope.identity && typeof envelope.identity === "object" ? envelope.identity : {};
  const family = envelope.template_family && typeof envelope.template_family === "object" ? envelope.template_family : {};
  const supportingChecks = new Map(
    (Array.isArray(map.supporting_checks) ? map.supporting_checks : [])
      .filter((check) => check && typeof check === "object")
      .map((check) => [String(check.name || ""), check]),
  );
  const expectedName = releaseIdentityKey(identity.expected?.business_name);
  const actualName = releaseIdentityKey(identity.actual?.business_name);
  const packetName = releaseIdentityKey(identity.actual?.public_packet_business_name);
  const expectedFamily = normalizedFamily(family.expected?.family);
  const actualFamily = normalizedFamily(family.actual?.family);
  const mapWaived = canonicalMapWaiver(map, supportingChecks);
  const mapPassed = Boolean(
    mapWaived
    || (
      map.verified === true
      && map.qc_check?.name === "release-map-evidence"
      && map.artifact === "screenshots/desktop/map.png"
      && map.evidence_artifact === "screenshots/map-evidence.json"
      && map.manifest_artifact === "screenshots/manifest.json"
      && Number(map.screenshot?.size || 0) > 64
      && /^[a-f0-9]{64}$/.test(String(map.screenshot?.sha256 || ""))
      && map.runtime?.response_ok === true
      && map.runtime?.geometry_ok === true
      && map.runtime?.pixels_ok === true
      && Number(map.runtime?.unique_colors || 0) >= 16
      && Number(map.runtime?.variance || 0) >= 80
      && map.manifest?.schema === "siteforge-screenshot-manifest-v1"
      && map.manifest?.map_pass === true
      && supportingChecks.get("visual-satellite-map-evidence")?.pass === true
      && supportingChecks.get("visual-address-map-directions")?.pass === true
    )
  );
  const identityPassed = Boolean(
    identity.verified === true
    && identity.qc_check?.name === "release-business-identity-match"
    && expectedName
    && expectedName === actualName
    && expectedName === packetName
    && Number(identity.actual?.local_business_nodes || 0) === 1
  );
  const familyPassed = Boolean(
    canonicalFamilyWaiver(family, expectedFamily, actualFamily)
    || (
      family.verified === true
      && family.qc_check?.name === "release-template-family-match"
      && expectedFamily
      && (
        (
          expectedFamily === "auto"
          && family.expected?.selection === "auto"
          && family.expected?.source === SITEFORGE_FAMILY_EXPECTATION_SOURCE
          && family.actual?.known_family === true
          && family.actual?.source === SITEFORGE_FAMILY_RENDER_SOURCE
          && Boolean(actualFamily)
        )
        || (
          expectedFamily !== "auto"
          && expectedFamily === actualFamily
        )
      )
    )
  );
  return {
    schemaValid: envelope.schema === "siteforge-release-evidence-v1",
    map: {
      passed: mapPassed,
      evidence: mapPassed ? (map.screenshot_url || map.artifact) : null,
    },
    identity: {
      passed: identityPassed,
      evidence: identityPassed ? (identity.public_packet_url || identity.actual) : null,
    },
    templateFamily: {
      passed: familyPassed,
      actual: actualFamily || null,
      expected: expectedFamily || null,
      evidence: familyPassed ? (family.public_packet_url || family.qc_check) : null,
    },
  };
}

function templateFamilyProof(sources) {
  const object = proofObject(sources, ["template_family_gate", "templateFamilyGate", "template_family_evidence", "templateFamilyEvidence"]);
  const proof = explicitProof(sources, {
    objectNames: ["template_family_gate", "templateFamilyGate", "template_family_evidence", "templateFamilyEvidence"],
    passNames: ["template_family_verified", "templateFamilyVerified", "template_family_passed", "templateFamilyPassed"],
    evidenceNames: ["template_family_proof", "templateFamilyProof", "template_family_screenshot_url", "templateFamilyScreenshotUrl"],
  });
  const actual = normalizedFamily(firstPresent(object ? [object, ...sources] : sources, [
    "actual", "selected", "family", "template_family", "templateFamily", "actual_template_family", "actualTemplateFamily",
  ]));
  const expected = normalizedFamily(firstPresent(object ? [object, ...sources] : sources, [
    "expected", "required", "expected_template_family", "expectedTemplateFamily", "required_template_family", "requiredTemplateFamily",
  ]));
  return {
    passed: proof.passed && Boolean(actual) && Boolean(expected) && actual === expected,
    actual: actual || null,
    expected: expected || null,
    evidence: proof.evidence,
  };
}

function phaseOneReleaseEvidence(prospect = {}) {
  const sources = nestedSources(prospect);
  const currentEvidence = currentSiteForgeEvidence(prospect);
  const renderer = String(firstPresent(sources, ["siteforge_renderer", "renderer"]) || "").trim();
  const fingerprint = String(firstPresent(sources, [
    "siteforge_generation_fingerprint",
    "siteforge_composition_fingerprint",
    "generation_fingerprint",
    "generationFingerprint",
    "composition_fingerprint",
    "compositionFingerprint",
  ]) || "").trim();
  const qcPassed = positiveGate(firstPresent(sources, ["siteforge_qc_passed", "qc_passed", "qcPassed"]));
  const visualQcPassed = positiveGate(firstPresent(sources, ["siteforge_visual_qc_passed", "visual_qc_passed", "visualQcPassed"]));
  const qcContract = String(firstPresent(sources, ["siteforge_qc_contract", "qc_contract", "qcContract"]) || "").trim();
  const previewUrl = publicHttpsArtifact(prospect, ["preview_url", "previewUrl"]);
  const reportUrl = publicHttpsArtifact(prospect, ["report_url", "reportUrl"]);
  const map = currentEvidence?.map || explicitProof(sources, {
    objectNames: ["map_gate", "mapGate", "map_evidence", "mapEvidence"],
    passNames: ["map_present", "mapPresent", "map_verified", "mapVerified", "map_passed", "mapPassed"],
    evidenceNames: ["map_proof", "mapProof", "map_screenshot_url", "mapScreenshotUrl", "map_url", "mapUrl"],
  });
  const identity = currentEvidence?.identity || explicitProof(sources, {
    objectNames: ["preview_identity_gate", "previewIdentityGate", "identity_evidence", "identityEvidence"],
    passNames: ["preview_identity_verified", "previewIdentityVerified", "identity_match", "identityMatch", "identity_verified", "identityVerified"],
    evidenceNames: ["identity_proof", "identityProof", "identity_evidence_url", "identityEvidenceUrl", "identity_screenshot_url", "identityScreenshotUrl"],
  });
  const templateFamily = currentEvidence?.templateFamily || templateFamilyProof(sources);
  const failures = [];
  if (currentEvidence && !currentEvidence.schemaValid) failures.push("release_evidence_schema_not_allowed");
  if (renderer !== REQUIRED_RENDERER) failures.push("renderer_not_allowed");
  if (!fingerprint) failures.push("generation_fingerprint_missing");
  if (!qcPassed) failures.push("qc_not_passed");
  if (!visualQcPassed) failures.push("visual_qc_not_passed");
  if (qcContract !== REQUIRED_QC_CONTRACT) failures.push("qc_contract_not_allowed");
  if (!previewUrl) failures.push("preview_url_not_public_https");
  if (!reportUrl) failures.push("report_url_not_public_https");
  if (!map.passed) failures.push("map_evidence_missing");
  if (!identity.passed) failures.push("preview_identity_evidence_missing");
  if (!templateFamily.passed) failures.push(
    templateFamily.actual && templateFamily.expected && templateFamily.actual !== templateFamily.expected
      ? "template_family_mismatch"
      : "template_family_evidence_missing",
  );
  return {
    ok: failures.length === 0,
    failures,
    renderer: renderer || null,
    generation_fingerprint: fingerprint || null,
    qc_passed: qcPassed,
    visual_qc_passed: visualQcPassed,
    qc_contract: qcContract || null,
    preview_url: previewUrl || null,
    report_url: reportUrl || null,
    map,
    identity,
    template_family: templateFamily,
  };
}

function localCompose({ prospect, dryRun }) {
  if (dryRun !== true) throw new Error("review drafts must be composed with dryRun: true");
  const name = String(value(prospect, ["business_name", "businessName", "name"]) || "your business").trim();
  const city = String(value(prospect, ["city", "market"]) || "your area").trim();
  const industry = String(value(prospect, ["industry", "category"]) || "local service").trim();
  const configuredSender = String(process.env.GHOST_AGENCY_SENDER_NAME || "Mark Woodward").trim();
  const senderName = configuredSender.toLowerCase() === "mark" ? "Mark Woodward" : configuredSender;
  // SIBLING COPY of the removed lib/email.js DEFAULT_AGENT_PHONE fallback: this
  // chain used to end in a literal agency number. Configuration only now. No
  // number configured => the "call or text me" line is dropped from the draft
  // entirely (see below), never rendered with a stale or empty number.
  const senderPhone = String(
    process.env.GHOST_AGENCY_SENDER_PHONE
    || process.env.GHOST_AGENT_PHONE
    || process.env.GHOST_AGENCY_AGENT_PHONE
    || "",
  ).trim();
  const postalAddress = String(process.env.GHOST_AGENCY_POSTAL_ADDRESS || "").trim();
  const complianceLines = [
    "Woodward Software / WSS Labs",
    ...(postalAddress ? [postalAddress] : []),
    OPT_OUT_PROMISE,
  ];
  return {
    mode: "dry_run",
    composePath: "local_consent_review_fallback",
    subject: `talk to your website and it changes — for ${name} in ${city}`,
    body: [
      `Hi ${name} team,`,
      `I'm ${senderName} — I run a small AI-powered web studio in California, and I build modern sites for local ${industry} businesses for about a tenth of what a traditional agency charges. AI does the heavy lifting, so I can keep it that low without cutting corners.`,
      `Here's the part people don't expect: your site comes with Riley, your own AI web person you can call anytime. You say "reword that headline," "swap that photo" — and it's done while you're on the phone, in real time. No ticket system, no emailing changes in, no waiting weeks on a freelancer for one small edit.`,
      `What's included:\n- Riley (AI assistant) by call — unlimited edits, done live\n- WSS Connect — all your social accounts in one built-in feed\n- Voice search & AI upgrades, "near me" optimization, Google/Apple Maps registry + directory indexing, plus ${city} competitor & search research\n- Lead-funnel widgets so visitors turn into calls\n- Hosting, SSL, custom domain setup, and unlimited edits — all included`,
      `If you'd like, reply and I'll build you a free custom preview — with your input — so you can see the style and try talking to Riley yourself. No charge, no obligation, and I never touch your current site.`,
      ...(senderPhone ? [`Prefer to talk it through? Call me: ${senderPhone}.`] : []),
      `— ${senderName}, Mission Viejo, CA`,
      complianceLines.join("\n"),
    ].join("\n\n"),
  };
}

function blocked(reason, detail) {
  return { ok: false, status: "held", reason, ...(detail ? { detail } : {}) };
}

async function durableHoldIsActive(loadHold) {
  const result = await loadHold();
  if (!result || result.mode !== "live_select" || !Array.isArray(result.rows)) return false;
  // A review batch is safe only when its durable authorization is singular and
  // active.  Do not let a duplicated, inactive, or partially-read hold state
  // authorize composition/persistence.
  return result.rows.length === 1
    && result.rows[0]?.hold_key === HOLD_KEY
    && result.rows[0]?.status === "active";
}

async function defaultLoadHold() {
  const result = await select(
    "ghost_agency_supervision_holds",
    `?select=hold_key,status,created_at&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&order=created_at.asc`,
  );
  return { mode: result.mode, rows: result.data || [] };
}

async function defaultLoadExistingDrafts() {
  const result = await select(
    "ghost_agency_outbound_review_drafts",
    `?select=draft_id,hold_key,prospect_id,recipient_email,preview_url,getfound_grade,subject,body,compose_mode,delivery_status,approval_status,created_at&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&order=created_at.asc&limit=${DRAFT_COUNT + 1}`,
  );
  return { mode: result.mode, rows: result.data || [] };
}

async function defaultLoadAuditEvents(drafts = []) {
  const ids = drafts.map((draft) => deterministicAuditEventId(draft.draft_id));
  if (!ids.length) return { mode: "live_select", rows: [] };
  const result = await select(
    "ghost_agency_events",
    `?select=id,type,payload,created_at&id=in.(${ids.join(",")})&limit=${DRAFT_COUNT}`,
  );
  return { mode: result.mode, rows: result.data || [] };
}

function auditEventMatchesDraft(row = {}, draft = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return row.id === deterministicAuditEventId(draft.draft_id)
    && row.type === "outbound.review_draft.created"
    && payload.actor === "admin_supervised_review_queue"
    && payload.status === "held"
    && payload.hold_key === HOLD_KEY
    && payload.draft_id === draft.draft_id
    && payload.prospect_id === draft.prospect_id
    && payload.compose_mode === "dry_run"
    && typeof payload.compose_path === "string"
    && Boolean(payload.compose_path.trim())
    && (payload.html_sha256 === null || /^[a-f0-9]{64}$/.test(String(payload.html_sha256 || "")))
    && payload.delivery_status === "review_only"
    && payload.approval_status === "awaiting_explicit_later_approval";
}

function exactExistingBatch(rows = [], prospects = []) {
  if (!Array.isArray(rows) || rows.length !== DRAFT_COUNT) return false;
  const expected = new Map(prospects.map((prospect) => [prospectId(prospect), {
    draftId: deterministicDraftId(prospect),
    email: emailOf(prospect),
    grade: getFoundGrade(prospect),
  }]));
  const seenIds = new Set();
  const seenEmails = new Set();
  const valid = rows.every((row) => {
    const id = String(row?.prospect_id || "").trim();
    const email = String(row?.recipient_email || "").trim().toLowerCase();
    const expectedRow = expected.get(id);
    seenIds.add(id);
    seenEmails.add(email);
    return row?.hold_key === HOLD_KEY
      && row.draft_id === expectedRow?.draftId
      && email === expectedRow?.email
      && !String(row.preview_url || "").trim()
      && row.getfound_grade === expectedRow?.grade
      && row.compose_mode === "dry_run"
      && row.delivery_status === "review_only"
      && row.approval_status === "awaiting_explicit_later_approval";
  });
  return valid && seenIds.size === DRAFT_COUNT && seenEmails.size === DRAFT_COUNT;
}

function auditEventRow(draft = {}, artifact = {}, createdAt = "") {
  return {
    id: deterministicAuditEventId(draft.draft_id),
    type: "outbound.review_draft.created",
    payload: {
      actor: "admin_supervised_review_queue",
      status: "held",
      hold_key: HOLD_KEY,
      draft_id: draft.draft_id,
      prospect_id: draft.prospect_id,
      compose_mode: "dry_run",
      compose_path: artifact.compose_path,
      html_sha256: artifact.html_sha256,
      delivery_status: "review_only",
      approval_status: "awaiting_explicit_later_approval",
    },
    created_at: createdAt,
  };
}

async function ensureAuditEvents({
  drafts,
  artifacts = [],
  loadAuditEvents,
  persistAuditEventBatch,
  composeMissingArtifact,
  now,
}) {
  const loaded = await loadAuditEvents(drafts);
  if (!loaded || loaded.mode !== "live_select" || !Array.isArray(loaded.rows)) {
    return blocked("draft_event_state_check_unavailable");
  }
  const draftByEventId = new Map(drafts.map((draft) => [deterministicAuditEventId(draft.draft_id), draft]));
  if (loaded.rows.some((row) => !draftByEventId.has(row.id) || !auditEventMatchesDraft(row, draftByEventId.get(row.id)))) {
    return blocked("draft_event_state_conflict");
  }
  const present = new Set(loaded.rows.map((row) => row.id));
  const missing = drafts.filter((draft) => !present.has(deterministicAuditEventId(draft.draft_id)));
  const artifactByDraftId = new Map(artifacts.map((artifact) => [artifact.draft_id, artifact]));

  if (missing.length) {
    for (const draft of missing) {
      if (artifactByDraftId.has(draft.draft_id)) continue;
      const artifact = await composeMissingArtifact(draft);
      if (!artifact || artifact.ok === false) {
        return blocked(artifact?.blocked || "draft_event_artifact_recovery_failed", draft.prospect_id);
      }
      artifactByDraftId.set(draft.draft_id, artifact);
    }
    const eventRows = missing.map((draft) => auditEventRow(draft, artifactByDraftId.get(draft.draft_id), now()));
    if (eventRows.some((row) => !auditEventMatchesDraft(row, draftByEventId.get(row.id)))) {
      return blocked("draft_event_artifact_recovery_failed");
    }
    const persisted = await persistAuditEventBatch(eventRows);
    if (!persisted || !["live_write", "live_upsert"].includes(persisted.mode)) {
      return blocked("draft_event_persistence_failed", { missingCount: missing.length });
    }
  }

  const verified = await loadAuditEvents(drafts);
  if (!verified || verified.mode !== "live_select" || !Array.isArray(verified.rows)) {
    return blocked("draft_event_verification_unavailable");
  }
  const verifiedIds = new Set(verified.rows.map((row) => row.id));
  if (
    verified.rows.length !== DRAFT_COUNT
    || verifiedIds.size !== DRAFT_COUNT
    || verified.rows.some((row) => !draftByEventId.has(row.id) || !auditEventMatchesDraft(row, draftByEventId.get(row.id)))
  ) {
    return blocked("draft_event_verification_failed", { verifiedCount: verifiedIds.size });
  }
  return { ok: true, repaired: missing.length };
}

async function defaultSuppressed(prospect) {
  const id = prospectId(prospect);
  const email = emailOf(prospect);
  const terms = [];
  if (id) terms.push(`prospect_id.eq.${encodeURIComponent(id)}`);
  if (email) terms.push(`email.eq.${encodeURIComponent(email)}`);
  if (!terms.length) return { known: false, suppressed: true };
  const result = await select(
    "ghost_agency_suppressions",
    `?select=prospect_id,email,suppression_key&or=(${terms.join(",")})&limit=1`,
  );
  if (!result.ok || result.mode !== "live_select") return { known: false, suppressed: true };
  return { known: true, suppressed: Array.isArray(result.data) && result.data.length > 0 };
}

function validateProspects(prospects) {
  if (!Array.isArray(prospects) || prospects.length !== DRAFT_COUNT) {
    return { reason: "requires_exactly_10_prospects" };
  }
  const ids = new Set();
  const emails = new Set();
  for (const prospect of prospects) {
    const id = prospectId(prospect);
    const email = emailOf(prospect);
    if (!id || !email || !highConfidence(prospect) || !getFoundGrade(prospect)) {
      return { reason: "prospect_missing_required_review_evidence", detail: id || "prospect_id_missing" };
    }
    if (ids.has(id) || emails.has(email)) return { reason: "prospects_must_be_unique" };
    ids.add(id);
    emails.add(email);
  }
  return null;
}

function consentDraftBody(composedBody, prospect, grade) {
  const body = String(composedBody || "").replace(/\{\{GETFOUND_GRADE\}\}/g, grade);
  if (/\{\{(?:PREVIEW_LINK|PREVIEW_URL|REPORT_LINK|REPORT_URL|CHECKOUT_URL|SUNSET_DATE)\}\}/i.test(body)) {
    return "";
  }
  const retiredArtifactUrls = [
    publicHttpsArtifact(prospect, ["preview_url", "previewUrl"]),
    publicHttpsArtifact(prospect, ["report_url", "reportUrl"]),
  ].filter(Boolean);
  return retiredArtifactUrls.some((url) => body.includes(url)) ? "" : body;
}

async function createHeldDraftQueue(input = {}, dependencies = {}) {
  const prospects = input.prospects;
  const loadHold = dependencies.loadHold || defaultLoadHold;
  const loadExistingDrafts = dependencies.loadExistingDrafts || defaultLoadExistingDrafts;
  const loadAuditEvents = dependencies.loadAuditEvents || defaultLoadAuditEvents;
  const isSuppressed = dependencies.isSuppressed || defaultSuppressed;
  const compose = dependencies.compose || localCompose;
  const persistDraftBatch = dependencies.persistDraftBatch || (dependencies.persistDraft
    ? async (rows) => {
        for (const row of rows) {
          const result = await dependencies.persistDraft(row);
          if (!result || !["live_write", "live_upsert"].includes(result.mode)) return result;
        }
        return { mode: "live_write" };
      }
    : (rows) => insertRow("ghost_agency_outbound_review_drafts", rows));
  const persistAuditEventBatch = dependencies.persistAuditEventBatch
    || ((rows) => insertRow("ghost_agency_events", rows));
  const now = dependencies.now || (() => new Date().toISOString());
  const prospectById = new Map((Array.isArray(prospects) ? prospects : []).map((prospect) => [prospectId(prospect), prospect]));
  const composeMissingArtifact = async (draft) => {
    const prospect = prospectById.get(draft.prospect_id);
    if (!prospect) return { ok: false, blocked: "draft_event_prospect_missing" };
    const composed = await compose({ prospect, dryRun: true });
    if (composed?.ok === false) return composed;
    const composedBody = composed?.body || composed?.bodyPreview;
    const html = String(composed?.html || composed?.htmlPreview || "");
    if (!composed?.subject || !composedBody) {
      return { ok: false, blocked: "draft_event_artifact_recovery_failed" };
    }
    const grade = getFoundGrade(prospect);
    const safeHtml = html ? consentDraftBody(html, prospect, grade) : "";
    if (!consentDraftBody(composedBody, prospect, grade) || (html && !safeHtml)) {
      return { ok: false, blocked: "draft_composition_not_consent_first" };
    }
    return {
      draft_id: draft.draft_id,
      prospect_id: draft.prospect_id,
      compose_path: String(composed.composePath || composed.compose_path || "local_review_fallback").slice(0, 120),
      compose_mode: String(composed.mode || "dry_run").slice(0, 40),
      html_preview: safeHtml || null,
      html_sha256: safeHtml ? createHash("sha256").update(safeHtml).digest("hex") : null,
    };
  };

  // The environment hold is a second gate; it can never substitute for durable state.
  if (!reviewHoldActive()) return blocked("review_hold_not_active");
  if (!(await durableHoldIsActive(loadHold))) return blocked("durable_supervised_10_review_pending_hold_required");

  const validationError = validateProspects(prospects);
  if (validationError) return blocked(validationError.reason, validationError.detail);

  for (const prospect of prospects) {
    const suppression = await isSuppressed(prospect);
    if (!suppression?.known) return blocked("suppression_check_unavailable", prospectId(prospect));
    if (suppression.suppressed) return blocked("suppressed_prospect", prospectId(prospect));
  }

  const existing = await loadExistingDrafts();
  if (!existing || existing.mode !== "live_select" || !Array.isArray(existing.rows)) {
    return blocked("held_draft_state_check_unavailable");
  }
  if (existing.rows.length) {
    if (!exactExistingBatch(existing.rows, prospects)) {
      return blocked("held_draft_batch_state_conflict", { existingCount: existing.rows.length });
    }
    const audit = await ensureAuditEvents({
      drafts: existing.rows,
      loadAuditEvents,
      persistAuditEventBatch,
      composeMissingArtifact,
      now,
    });
    if (!audit.ok) return audit;
    return {
      ok: true,
      status: "held_for_review",
      hold_key: HOLD_KEY,
      count: DRAFT_COUNT,
      drafts: existing.rows,
      artifacts: [],
      sends_performed: 0,
      idempotent_replay: true,
      audit_events_repaired: audit.repaired,
      next_action: "Mark must explicitly approve later in a separate, audited workflow.",
    };
  }

  const prepared = [];
  const artifacts = [];
  for (const prospect of prospects) {
    const composed = await compose({ prospect, dryRun: true });
    if (composed?.ok === false) {
      return blocked(composed.blocked || "draft_composition_failed", prospectId(prospect));
    }
    const composedBody = composed?.body || composed?.bodyPreview;
    if (!composed?.subject || !composedBody) return blocked("draft_composition_failed", prospectId(prospect));
    const grade = getFoundGrade(prospect);
    const body = consentDraftBody(composedBody, prospect, grade);
    const html = String(composed.html || composed.htmlPreview || "");
    const safeHtml = html ? consentDraftBody(html, prospect, grade) : "";
    if (!body || (html && !safeHtml)) return blocked("draft_composition_not_consent_first", prospectId(prospect));
    const draftId = deterministicDraftId(prospect);
    const composePath = String(composed.composePath || composed.compose_path || "local_review_fallback").slice(0, 120);
    prepared.push({
      draft_id: draftId,
      hold_key: HOLD_KEY,
      prospect_id: prospectId(prospect),
      recipient_email: emailOf(prospect),
      // Compatibility column only. A consent-first cold draft has no preview.
      preview_url: null,
      getfound_grade: grade,
      subject: String(composed.subject).slice(0, 180),
      body,
      compose_mode: "dry_run",
      delivery_status: "review_only",
      approval_status: "awaiting_explicit_later_approval",
      created_at: now(),
    });
    artifacts.push({
      draft_id: draftId,
      prospect_id: prospectId(prospect),
      compose_path: composePath,
      compose_mode: String(composed.mode || "dry_run").slice(0, 40),
      html_preview: safeHtml || null,
      html_sha256: safeHtml ? createHash("sha256").update(safeHtml).digest("hex") : null,
    });
  }

  const persisted = await persistDraftBatch(prepared);
  if (!persisted || !["live_write", "live_upsert"].includes(persisted.mode)) {
    return blocked("draft_batch_persistence_failed");
  }

  const audit = await ensureAuditEvents({
    drafts: prepared,
    artifacts,
    loadAuditEvents,
    persistAuditEventBatch,
    composeMissingArtifact,
    now,
  });
  if (!audit.ok) return audit;

  return {
    ok: true,
    status: "held_for_review",
    hold_key: HOLD_KEY,
    count: DRAFT_COUNT,
    drafts: prepared,
    artifacts,
    sends_performed: 0,
    audit_events_repaired: audit.repaired,
    next_action: "Mark must explicitly approve later in a separate, audited workflow.",
  };
}

module.exports = {
  DRAFT_COUNT,
  HOLD_KEY,
  createHeldDraftQueue,
  getFoundGrade,
  highConfidence,
  localCompose,
  phaseOneReleaseEvidence,
  publicHttpsArtifact,
};
