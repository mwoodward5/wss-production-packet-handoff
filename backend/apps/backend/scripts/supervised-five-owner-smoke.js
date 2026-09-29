"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { buildPreviewForProspect } = require("../lib/full-run");
const { sendSequenceStep } = require("../lib/email");
const { firstValue, prospectFromRow, prospectId } = require("../lib/prospects");
const { REQUIRED_QC_CONTRACT, REQUIRED_RENDERER } = require("../lib/siteforge");
const { select, selectRows } = require("../lib/store");

const EXPECTED_COUNT = 5;
const OWNER_EMAIL = "WoodwardSoftware@gmail.com";
const OWNER_EMAIL_NORMALIZED = OWNER_EMAIL.toLowerCase();
const SEND_CONFIRMATION = "SEND_OWNER_FIVE";
const CONTACT_EMAIL_FIELDS = ["email", "owner_email", "ownerEmail", "contact_email", "contactEmail"];
const ELIGIBLE_STATUSES = new Set(["new", "previewed"]);
let ownerEmailEnvironmentActive = false;

class SmokeBlockedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SmokeBlockedError";
    this.code = code;
    this.details = details;
  }
}

function blocked(code, message, details = {}) {
  return new SmokeBlockedError(code, message, details);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function recipientList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const recipient = String(value || "").trim();
  return recipient ? [recipient] : [];
}

function ownerProofRecipients(env = process.env) {
  const owner = String(env.GHOST_AGENCY_OWNER_EMAIL || OWNER_EMAIL).trim() || OWNER_EMAIL;
  const cc = recipientList(env.GHOST_AGENCY_OUTREACH_CC)
    .filter((item, index, items) => items.findIndex((candidate) => normalizeEmail(candidate) === normalizeEmail(item)) === index)
    .filter((item) => normalizeEmail(item) !== normalizeEmail(owner));
  return { owner, cc };
}

function assertOwnerOnlyEnvelope({ to, cc = [], bcc = [] } = {}, allowed = ownerProofRecipients()) {
  const toList = recipientList(to);
  const ccList = recipientList(cc);
  const bccList = recipientList(bcc);
  const all = [...toList, ...ccList, ...bccList];
  const expectedCc = allowed.cc.map(normalizeEmail).sort();
  const actualCc = ccList.map(normalizeEmail).sort();
  const allowedEmails = new Set([allowed.owner, ...allowed.cc].map(normalizeEmail));
  const ownerOnly = normalizeEmail(toList[0]) === normalizeEmail(allowed.owner)
    && actualCc.join(",") === expectedCc.join(",")
    && all.every((item) => allowedEmails.has(normalizeEmail(item)));

  if (toList.length !== 1 || !ownerOnly || bccList.length) {
    throw blocked(
      "recipient_gate_failed",
      "Owner proof delivery requires the configured owner and cc recipients with no bcc.",
      { toCount: toList.length, ccCount: ccList.length, bccCount: bccList.length },
    );
  }

  return { to: allowed.owner, cc: allowed.cc, bcc: [] };
}

function parseProspectIds(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertExactlyFiveIds(ids) {
  const list = Array.isArray(ids) ? ids.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const unique = new Set(list);
  if (list.length !== EXPECTED_COUNT || unique.size !== EXPECTED_COUNT) {
    throw blocked(
      "exactly_five_prospect_ids_required",
      `Expected exactly ${EXPECTED_COUNT} unique prospect IDs.`,
      { supplied: list.length, unique: unique.size },
    );
  }
  return list;
}

function parseCliArgs(argv = [], env = process.env) {
  let prospectIds = parseProspectIds(env.GHOST_AGENCY_OWNER_FIVE_PROSPECT_IDS || "");
  let outputDir = "";
  let confirmationPhrase = "";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--prospect-ids") {
      prospectIds = parseProspectIds(argv[++index]);
      continue;
    }
    if (arg.startsWith("--prospect-ids=")) {
      prospectIds = parseProspectIds(arg.slice("--prospect-ids=".length));
      continue;
    }
    if (arg === "--output-dir") {
      outputDir = String(argv[++index] || "").trim();
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      outputDir = String(arg.slice("--output-dir=".length)).trim();
      continue;
    }
    if (arg === "--confirm") {
      confirmationPhrase = String(argv[++index] || "").trim();
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      confirmationPhrase = String(arg.slice("--confirm=".length)).trim();
      continue;
    }
    throw blocked("unknown_argument", `Unknown argument: ${arg}`);
  }

  if (prospectIds.length) assertExactlyFiveIds(prospectIds);
  if (confirmationPhrase && confirmationPhrase !== SEND_CONFIRMATION) {
    throw blocked("confirmation_phrase_invalid", `Live owner delivery requires --confirm ${SEND_CONFIRMATION}.`);
  }

  return { prospectIds, outputDir, confirmationPhrase, help };
}

function usage() {
  return [
    "Supervised owner-only five-prospect smoke",
    "",
    "Compose only (safely selects five persisted mined leads):",
    "  node scripts/supervised-five-owner-smoke.js",
    "",
    "Compose only (explicit persisted IDs):",
    "  node scripts/supervised-five-owner-smoke.js --prospect-ids id1,id2,id3,id4,id5",
    "",
    "Owner send (never run without explicit approval):",
    `  node scripts/supervised-five-owner-smoke.js --prospect-ids id1,id2,id3,id4,id5 --confirm ${SEND_CONFIRMATION}`,
  ].join("\n");
}

function sourceOf(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  return firstValue(prospect, ["source"], firstValue(record, ["source"], ""));
}

function truthPacketOf(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const packet = prospect.truth_packet || record.truth_packet;
  return packet && typeof packet === "object" ? packet : null;
}

function minedEligibility(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const id = prospectId(prospect);
  const businessName = firstValue(prospect, ["business_name", "businessName", "name", "company"]);
  const status = firstValue(prospect, ["status"], "new").toLowerCase();
  const placeId = firstValue(prospect, ["place_id", "placeId"], firstValue(record, ["place_id", "placeId"]));
  const source = sourceOf(prospect);
  const truthSource = firstValue(
    prospect,
    ["truth_packet_source"],
    firstValue(record, ["truth_packet_source"], String(truthPacketOf(prospect)?.meta?.source || "")),
  );
  const mined = Boolean(placeId || /places|google|lead.?miner/i.test(`${source} ${truthSource}`));

  if (!id) return { ok: false, reason: "prospect_id_missing" };
  if (!businessName) return { ok: false, reason: "business_name_missing" };
  if (!ELIGIBLE_STATUSES.has(status)) return { ok: false, reason: `status_${status}_not_eligible` };
  if (!mined) return { ok: false, reason: "mined_lead_provenance_missing" };
  return { ok: true, id, businessName, status, source: source || truthSource || "persisted_mined_lead" };
}

function assertExactlyFiveProspects(prospects) {
  if (!Array.isArray(prospects)) {
    throw blocked("prospect_selection_invalid", "Prospect selection did not return an array.");
  }
  const ids = prospects.map((prospect) => prospectId(prospect));
  assertExactlyFiveIds(ids);
  return prospects;
}

async function loadExistingProspects(prospectIds, deps) {
  if (prospectIds.length) {
    const rows = [];
    for (const id of assertExactlyFiveIds(prospectIds)) {
      const result = await deps.select(
        "ghost_agency_prospects",
        `?select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
      );
      if (!result || result.ok !== true) {
        throw blocked("prospect_store_read_failed", "Could not read an explicitly selected persisted prospect.", { prospectId: id });
      }
      if (!Array.isArray(result.data) || result.data.length !== 1) {
        throw blocked("prospect_id_not_found", "An explicitly selected prospect ID was not found.", { prospectId: id });
      }
      rows.push(result.data[0]);
    }
    const prospects = rows.map(prospectFromRow).filter(Boolean);
    for (const prospect of prospects) {
      const eligibility = minedEligibility(prospect);
      if (!eligibility.ok) {
        throw blocked("selected_prospect_not_eligible", "An explicitly selected prospect is not an eligible mined lead.", {
          prospectId: prospectId(prospect),
          reason: eligibility.reason,
        });
      }
    }
    return assertExactlyFiveProspects(prospects);
  }

  const result = await deps.selectRows("ghost_agency_prospects", {
    order: "updated_at.desc",
    limit: 500,
  });
  if (!result || result.mode !== "live_select" || !Array.isArray(result.rows)) {
    throw blocked("prospect_store_read_failed", "Live persisted prospects are required; no manual fallback is allowed.");
  }
  const eligible = result.rows
    .map(prospectFromRow)
    .filter(Boolean)
    .filter((prospect) => minedEligibility(prospect).ok)
    .sort((left, right) => Number(Boolean(truthPacketOf(right))) - Number(Boolean(truthPacketOf(left))));

  if (eligible.length < EXPECTED_COUNT) {
    throw blocked("not_enough_eligible_mined_prospects", "Fewer than five eligible persisted mined leads are available.", {
      eligible: eligible.length,
    });
  }
  return assertExactlyFiveProspects(eligible.slice(0, EXPECTED_COUNT));
}

function privateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function assertPublicHttpsUrl(value, label = "artifact") {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw blocked("artifact_url_invalid", `${label} URL is invalid.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const ipHostname = hostname.replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(ipHostname);
  const forbiddenName =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname === "example.com" ||
    hostname.endsWith(".example.com");
  const privateIp = ipVersion === 4
    ? privateIpv4(ipHostname)
    : ipVersion === 6 && (ipHostname === "::1" || /^(fc|fd|fe8|fe9|fea|feb)/i.test(ipHostname));

  if (parsed.protocol !== "https:" || !hostname || parsed.username || parsed.password || forbiddenName || privateIp) {
    throw blocked("artifact_url_not_public_https", `${label} URL must be a real public HTTPS URL.`);
  }
  return parsed;
}

async function validateArtifactUrl(value, label, fetchImpl, options = {}) {
  assertPublicHttpsUrl(value, label);
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 15000, 1000), 15000);
  let response;
  try {
    response = await fetchImpl(value, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-2047" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw blocked("artifact_url_fetch_failed", `${label} URL could not be fetched.`, {
      reason: redactMessage(error && error.message),
    });
  }

  try {
    if (!response || !response.ok) {
      throw blocked("artifact_url_http_failed", `${label} URL did not return a successful response.`, {
        status: Number(response && response.status) || 0,
      });
    }
    if (response.url) assertPublicHttpsUrl(response.url, `${label} redirect`);
    return {
      ok: true,
      status: Number(response.status) || 200,
      content_type: String(response.headers?.get?.("content-type") || "").slice(0, 120),
    };
  } finally {
    if (response && response.body && typeof response.body.cancel === "function") {
      await response.body.cancel().catch(() => null);
    }
  }
}

function buildGateFailures(item = {}, expectedProspectId = "") {
  const failures = [];
  const actualProspectId = String(item.prospect_id || "").trim();
  if (!actualProspectId) failures.push("prospect_id_missing");
  if (expectedProspectId && actualProspectId !== String(expectedProspectId)) failures.push("prospect_id_mismatch");
  if (item.ok !== true) failures.push(item.blocked || "build_not_ready");
  if (item.renderer !== REQUIRED_RENDERER) failures.push("renderer_not_allowed");
  if (!String(item.generation_fingerprint || "").trim()) failures.push("generation_fingerprint_missing");
  if (item.qc_passed !== true) failures.push("qc_not_passed");
  if (item.visual_qc_passed !== true) failures.push("visual_qc_not_passed");
  if (item.qc_contract !== REQUIRED_QC_CONTRACT) failures.push("qc_contract_not_allowed");
  if (!item.preview_url) failures.push("preview_url_missing");
  if (!item.report_url) failures.push("report_url_missing");
  return [...new Set(failures)];
}

function assertBuildGate(item = {}, expectedProspectId = "") {
  const failures = buildGateFailures(item, expectedProspectId);
  if (failures.length) {
    throw blocked("siteforge_gate_failed", "A SiteForge build failed the owner-smoke release gate.", {
      prospectId: item.prospect_id || null,
      failures,
    });
  }
  return item;
}

function scrubContactEmails(input = {}, ownerEmail = ownerProofRecipients().owner) {
  const output = { ...input };
  for (const field of CONTACT_EMAIL_FIELDS) output[field] = ownerEmail;
  return output;
}

function ownerDeliveryProspect(prospect = {}, build = {}) {
  const recipients = ownerProofRecipients();
  const originalRecord = prospect.record && typeof prospect.record === "object" ? prospect.record : null;
  const delivery = scrubContactEmails({
    ...prospect,
    prospect_id: build.prospect_id || prospectId(prospect),
    report_url: build.report_url,
    preview_url: build.preview_url,
    checkout_url: build.checkout_url || firstValue(prospect, ["checkout_url", "checkoutUrl"]),
    siteforge_qc_passed: build.qc_passed,
    siteforge_visual_qc_passed: build.visual_qc_passed,
    siteforge_qc_contract: build.qc_contract,
    siteforge_renderer: build.renderer,
  }, recipients.owner);
  if (originalRecord) delivery.record = scrubContactEmails(originalRecord, recipients.owner);

  for (const field of CONTACT_EMAIL_FIELDS) {
    if (normalizeEmail(delivery[field]) !== normalizeEmail(recipients.owner)) {
      throw blocked("delivery_clone_recipient_failed", "A delivery contact field was not owner-only.");
    }
    if (delivery.record && normalizeEmail(delivery.record[field]) !== normalizeEmail(recipients.owner)) {
      throw blocked("delivery_clone_recipient_failed", "A nested delivery contact field was not owner-only.");
    }
  }
  assertOwnerOnlyEnvelope({ to: delivery.email, cc: [], bcc: [] }, { owner: recipients.owner, cc: [] });
  return delivery;
}

async function withOwnerOnlyCc(callback, options = {}) {
  if (ownerEmailEnvironmentActive) {
    throw blocked("owner_email_delivery_busy", "Another owner-only email operation is already in progress.");
  }
  ownerEmailEnvironmentActive = true;
  const configured = ownerProofRecipients();
  const keys = ["GHOST_AGENCY_OUTREACH_CC", "GHOST_AGENCY_OWNER_EMAIL"];
  if (options.disableOrganicComposition) keys.push("GHOST_AGENCY_ORGANIC_EMAIL");
  const previous = new Map(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined]));
  process.env.GHOST_AGENCY_OUTREACH_CC = configured.cc.join(",");
  process.env.GHOST_AGENCY_OWNER_EMAIL = configured.owner;
  if (options.disableOrganicComposition) process.env.GHOST_AGENCY_ORGANIC_EMAIL = "off";
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    ownerEmailEnvironmentActive = false;
  }
}

function emailVars(prospect, build, runId) {
  const services = prospect.services || prospect.primary_services || [];
  const service = Array.isArray(services) ? services[0] : "";
  return {
    run_id: runId,
    report_url: build.report_url,
    preview_url: build.preview_url,
    checkout_url: build.checkout_url || "",
    keyword_1: `${service || prospect.industry || prospect.category || "local service"} ${prospect.city || prospect.market || ""}`.trim(),
  };
}

async function invokeOwnerEmailPath({ prospect, build, runId, dryRun, deps, disableOrganicComposition = false }) {
  assertBuildGate(build, prospectId(prospect));
  const recipients = ownerProofRecipients();
  const deliveryProspect = ownerDeliveryProspect(prospect, build);
  const originalEmails = CONTACT_EMAIL_FIELDS
    .flatMap((field) => [prospect[field], prospect.record?.[field]])
    .map(normalizeEmail)
    .filter(Boolean);
  if (recipients.cc.some((item) => originalEmails.includes(normalizeEmail(item)))) {
    throw blocked("recipient_gate_failed", "Configured owner proof cc cannot include the real prospect recipient.");
  }
  const envelope = assertOwnerOnlyEnvelope({ to: deliveryProspect.email, cc: recipients.cc, bcc: [] }, recipients);

  const result = await withOwnerOnlyCc(
    () => deps.sendSequenceStep({
      prospect: deliveryProspect,
      sequence: 1,
      step: 1,
      dryRun,
      // email.sendSequenceStep independently requires internalOwnerProof and
      // an exact match to GHOST_AGENCY_OWNER_EMAIL before honoring this flag.
      // The cloned envelope above has already removed every prospect address.
      allowReviewHoldBypass: true,
      allowDeliveryPauseBypass: true,
      internalOwnerProof: true,
      allowContactQualityBypass: true,
      persistCampaignLog: false,
      vars: emailVars(prospect, build, runId),
    }),
    { disableOrganicComposition },
  );

  if (!result || result.ok !== true) {
    throw blocked("owner_email_path_blocked", "The existing report/email path blocked the owner smoke.", {
      prospectId: build.prospect_id,
      reason: result?.blocked || result?.mode || "email_path_failed",
    });
  }
  if (dryRun) {
    if (result.mode !== "dry_run" || typeof result.htmlPreview !== "string" || !result.htmlPreview.trim()) {
      throw blocked("email_preview_missing", "Compose-only mode did not return an HTML email preview.", {
        prospectId: build.prospect_id,
      });
    }
    assertOwnerOnlyEnvelope({ to: envelope.to, cc: result.cc, bcc: [] }, recipients);
  } else if (result.mode !== "sent") {
    throw blocked("owner_email_not_sent", "Confirmed owner delivery did not return sent mode.", {
      prospectId: build.prospect_id,
      mode: result.mode || "unknown",
    });
  }
  return { result, envelope };
}

function safeFilePart(value, fallback) {
  const output = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return output || fallback;
}

function redactMessage(value) {
  let output = String(value || "Unknown error").slice(0, 1000);
  output = output.replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]");
  output = output.replace(/([?&](?:api_?key|key|token|secret|signature|sig)=)[^&\s]+/gi, "$1[REDACTED]");
  const secrets = Object.entries(process.env)
    .filter(([key, secret]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key) && String(secret || "").length >= 6)
    .map(([, secret]) => String(secret))
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
  return output;
}

function safeError(error) {
  return {
    code: error?.code || "owner_five_smoke_failed",
    message: redactMessage(error?.message || error),
    details: sanitizeDetails(error?.details),
  };
}

function sanitizeDetails(value, depth = 0) {
  if (value === undefined || value === null || depth > 5) return undefined;
  if (typeof value === "string") return redactMessage(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeDetails(item, depth + 1));
  if (typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeDetails(item, depth + 1)]),
  );
}

function buildArtifactEntry(prospect, build = {}) {
  const eligibility = minedEligibility(prospect);
  return {
    prospect_id: prospectId(prospect),
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
    persisted_status: firstValue(prospect, ["status"], ""),
    source: eligibility.source || sourceOf(prospect) || null,
    truth_packet_source: firstValue(
      prospect,
      ["truth_packet_source"],
      String(truthPacketOf(prospect)?.meta?.source || ""),
    ) || null,
    build: {
      ok: build.ok === true,
      status: build.status || null,
      renderer: build.renderer || null,
      required_renderer: REQUIRED_RENDERER,
      generation_fingerprint: build.generation_fingerprint || null,
      qc_passed: build.qc_passed === true,
      visual_qc_passed: build.visual_qc_passed === true,
      qc_contract: build.qc_contract || null,
      required_qc_contract: REQUIRED_QC_CONTRACT,
      blocked: build.blocked || null,
      preview_url: build.preview_url || null,
      report_url: build.report_url || null,
    },
    url_validation: null,
    email: null,
  };
}

function defaultOutputDir(runId) {
  const repoRoot = path.resolve(__dirname, "../../..");
  return path.join(repoRoot, "artifacts", "supervised-five-owner-smoke", runId);
}

async function writeArtifact(outputDir, artifact, deps) {
  await deps.mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, "artifact.json");
  const temporaryPath = `${artifactPath}.tmp`;
  await deps.writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await deps.rename(temporaryPath, artifactPath);
  return artifactPath;
}

function defaultDependencies() {
  return {
    buildPreviewForProspect,
    fetch: globalThis.fetch,
    mkdir: fs.mkdir,
    rename: fs.rename,
    select,
    selectRows,
    sendSequenceStep,
    writeFile: fs.writeFile,
  };
}

async function runOwnerFiveSmoke(options = {}, overrides = {}) {
  const deps = { ...defaultDependencies(), ...overrides };
  const runId = options.runId || `owner_five_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const outputDir = path.resolve(options.outputDir || defaultOutputDir(runId));
  const confirmationPhrase = String(options.confirmationPhrase || "").trim();
  if (confirmationPhrase && confirmationPhrase !== SEND_CONFIRMATION) {
    throw blocked("confirmation_phrase_invalid", `Live owner delivery requires ${SEND_CONFIRMATION}.`);
  }
  const liveOwnerSend = confirmationPhrase === SEND_CONFIRMATION;
  const artifact = {
    schema_version: "supervised-five-owner-smoke-v1",
    run_id: runId,
    created_at: new Date().toISOString(),
    completed_at: null,
    ok: false,
    status: "started",
    mode: liveOwnerSend ? "confirmed_owner_send" : "compose_only",
    expected_count: EXPECTED_COUNT,
    selection: {
      mode: options.prospectIds?.length ? "explicit_ids" : "recent_eligible_persisted",
      prospect_ids: [],
    },
    delivery: {
      to: ownerProofRecipients().owner,
      normalized_to: normalizeEmail(ownerProofRecipients().owner),
      cc: ownerProofRecipients().cc,
      bcc: [],
      recipient_count: 1 + ownerProofRecipients().cc.length,
    },
    safety: {
      compose_only_default: true,
      confirmation_required: SEND_CONFIRMATION,
      confirmation_present: liveOwnerSend,
      campaign_invoked: false,
      charge_invoked: false,
      deploy_invoked: false,
      owner_send_attempted: false,
      owner_sends_completed: 0,
    },
    prospects: [],
    errors: [],
  };

  let artifactPath = "";
  const persist = async () => {
    artifactPath = await writeArtifact(outputDir, artifact, deps);
    return artifactPath;
  };

  await persist();
  try {
    assertOwnerOnlyEnvelope(artifact.delivery);
    const selected = await loadExistingProspects(options.prospectIds || [], deps);
    artifact.selection.prospect_ids = selected.map((prospect) => prospectId(prospect));
    artifact.status = "building";
    await persist();

    const builds = [];
    for (const prospect of selected) {
      let build;
      try {
        build = await deps.buildPreviewForProspect(prospect, {
          runId,
          source: "supervised_five_owner_smoke",
          persist: false,
        });
      } catch (error) {
        build = {
          ok: false,
          prospect_id: prospectId(prospect),
          business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"]),
          status: "blocked",
          blocked: error?.code || "build_exception",
        };
      }
      builds.push(build);
      artifact.prospects.push(buildArtifactEntry(prospect, build));
      await persist();
    }

    if (builds.length !== EXPECTED_COUNT) {
      throw blocked("exact_build_count_failed", `Expected exactly ${EXPECTED_COUNT} build results.`, { built: builds.length });
    }
    const gateFailures = builds
      .map((build, index) => ({
        prospectId: prospectId(selected[index]),
        failures: buildGateFailures(build, prospectId(selected[index])),
      }))
      .filter((item) => item.failures.length);
    if (gateFailures.length) {
      throw blocked("siteforge_batch_gate_failed", "No email may be rendered or sent until all five builds pass QC.", {
        prospects: gateFailures,
      });
    }

    artifact.status = "validating_urls";
    await persist();
    for (let index = 0; index < builds.length; index += 1) {
      const build = assertBuildGate(builds[index], prospectId(selected[index]));
      const preview = await validateArtifactUrl(build.preview_url, "preview", deps.fetch);
      const report = await validateArtifactUrl(build.report_url, "report", deps.fetch);
      artifact.prospects[index].url_validation = { preview, report };
      await persist();
    }

    artifact.status = "composing";
    await persist();
    const composed = [];
    for (let index = 0; index < selected.length; index += 1) {
      const composedEmail = await invokeOwnerEmailPath({
        prospect: selected[index],
        build: builds[index],
        runId,
        dryRun: true,
        deps,
      });
      const previewFile = `${String(index + 1).padStart(2, "0")}-${safeFilePart(prospectId(selected[index]), `prospect-${index + 1}`)}.html`;
      await deps.writeFile(path.join(outputDir, previewFile), composedEmail.result.htmlPreview, "utf8");
      composed.push(composedEmail);
      artifact.prospects[index].email = {
        preview_file: previewFile,
        composed: true,
        sent: false,
        delivery_to: ownerProofRecipients().owner,
        cc: ownerProofRecipients().cc,
      };
      await persist();
    }
    if (composed.length !== EXPECTED_COUNT) {
      throw blocked("exact_compose_count_failed", `Expected exactly ${EXPECTED_COUNT} composed owner previews.`, {
        composed: composed.length,
      });
    }

    if (!liveOwnerSend) {
      artifact.ok = true;
      artifact.status = "composed";
      artifact.completed_at = new Date().toISOString();
      await persist();
      return { ok: true, runId, mode: artifact.mode, artifactPath, outputDir, artifact };
    }

    for (const composedEmail of composed) assertOwnerOnlyEnvelope(composedEmail.envelope);
    artifact.status = "sending_owner";
    artifact.safety.owner_send_attempted = true;
    await persist();
    for (let index = 0; index < selected.length; index += 1) {
      const delivered = await invokeOwnerEmailPath({
        prospect: selected[index],
        build: builds[index],
        runId,
        dryRun: false,
        deps,
      });
      assertOwnerOnlyEnvelope(delivered.envelope);
      artifact.prospects[index].email.sent = true;
      artifact.prospects[index].email.provider_mode = delivered.result.mode;
      artifact.safety.owner_sends_completed += 1;
      await persist();
    }

    artifact.ok = true;
    artifact.status = "owner_sent";
    artifact.completed_at = new Date().toISOString();
    await persist();
    return { ok: true, runId, mode: artifact.mode, artifactPath, outputDir, artifact };
  } catch (error) {
    artifact.ok = false;
    artifact.status = "blocked";
    artifact.completed_at = new Date().toISOString();
    artifact.errors.push(safeError(error));
    await persist().catch(() => null);
    error.artifactPath = artifactPath;
    error.outputDir = outputDir;
    throw error;
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await runOwnerFiveSmoke(args);
  console.log(JSON.stringify({
    ok: result.ok,
    runId: result.runId,
    mode: result.mode,
    status: result.artifact.status,
    count: result.artifact.prospects.length,
    artifactPath: result.artifactPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || "owner_five_smoke_failed",
      message: redactMessage(error?.message || error),
      artifactPath: error?.artifactPath || null,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_COUNT,
  OWNER_EMAIL,
  OWNER_EMAIL_NORMALIZED,
  SEND_CONFIRMATION,
  SmokeBlockedError,
  assertBuildGate,
  assertExactlyFiveIds,
  assertOwnerOnlyEnvelope,
  assertPublicHttpsUrl,
  buildGateFailures,
  invokeOwnerEmailPath,
  minedEligibility,
  ownerDeliveryProspect,
  ownerProofRecipients,
  parseCliArgs,
  runOwnerFiveSmoke,
  validateArtifactUrl,
};
