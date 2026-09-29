"use strict";

// lib/line-report.js — the Signal report, generated FOR THE LINE.
//
// The report has existed the whole time and no line prospect ever got one:
// lib/full-run.js hardcodes `report_url: ""` for the mirror lane, and the only
// caller of the CallPrep adapter is an HTTP endpoint nothing in the line hits.
// So every proof email shipped a website with no evidence of WHY the prospect
// needed one.
//
// This is the adapter's own sequence — live scan first, static packet as the
// fail-soft fallback — behind one function the send path can await.
//
// Live prospect delivery remains fail-soft. Owner-only Practice instead uses a
// neutral static projection of the certified packet and requires the exact row
// to exist before its proof email can proceed.

const {
  canonicalCallPrepReportUrl,
  customerSafePacket,
  existingCallPrepReportUrl,
  saveBusinessReport,
  saveScannedBusinessReport,
} = require("./callprep-client");
const { scanBusiness } = require("./callprep-enrich");
const { normalizeBusinessName } = require("./prospect-identity");

const GENIE_REPORT_PACKET_ID_PREFIX = "wss-genie-cert-v1:";
const GENIE_RECEIPT_SIGNATURE = /^[0-9a-f]{64}$/;
const CALLPREP_REPORT_HOST = "callprep.wss-ai.com";
const immutableSaveFlights = new WeakMap();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function verifyImmutablePacket(prospect, record, options) {
  const verify = options.verifyGenieContentReceipt
    || require("./line-adapters").verifiedGenieContentReceipt;
  const verifyOptions = {};
  if (Object.prototype.hasOwnProperty.call(options, "certificationKey")) {
    verifyOptions.certificationKey = options.certificationKey;
  }
  if (Number.isFinite(Number(options.nowMs))) verifyOptions.nowMs = Number(options.nowMs);
  return verify(prospect, record, verifyOptions);
}

function genieReportPacketId(receipt = {}) {
  const signature = clean(receipt.signature);
  return GENIE_RECEIPT_SIGNATURE.test(signature)
    ? `${GENIE_REPORT_PACKET_ID_PREFIX}${signature}`
    : "";
}

function reportDomain(value) {
  let raw = clean(value).toLowerCase();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return "";
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function immutableReportIdentity(projected = {}) {
  const identity = projected.reportIdentity && typeof projected.reportIdentity === "object"
    ? projected.reportIdentity
    : {};
  const domainValue = clean(identity.domain);
  const domain = reportDomain(domainValue);
  return {
    packetId: clean(identity.packetId),
    businessName: normalizeBusinessName(identity.businessName),
    domain,
    domainInvalid: Boolean(domainValue) && !domain,
  };
}

function existingReportIdentityVerdict(projected = {}, availability = {}) {
  const expected = immutableReportIdentity(projected);
  const returned = availability.identity && typeof availability.identity === "object"
    ? availability.identity
    : null;
  if (!returned) return { ok: false, reason: "existing_report_identity_missing" };

  const returnedDomainValue = clean(returned.businessUrl);
  const returnedDomain = reportDomain(returnedDomainValue);
  const actual = {
    packetId: clean(returned.packetId),
    businessName: normalizeBusinessName(returned.businessName),
    domain: returnedDomain,
    domainInvalid: Boolean(returnedDomainValue) && !returnedDomain,
  };
  if (!expected.packetId || !expected.businessName || expected.domainInvalid
    || !actual.packetId || !actual.businessName) {
    return { ok: false, reason: "existing_report_identity_missing" };
  }
  if (actual.domainInvalid) return { ok: false, reason: "existing_report_identity_mismatch" };
  if (actual.packetId !== expected.packetId || actual.businessName !== expected.businessName) {
    return { ok: false, reason: "existing_report_identity_mismatch" };
  }
  // A genuinely website-less signed packet has no canonical domain. Preserve
  // that lane only when the stored report is also domainless; one-sided or
  // different domains are an identity mismatch.
  if (actual.domain !== expected.domain) {
    return { ok: false, reason: "existing_report_identity_mismatch" };
  }
  return { ok: true };
}

function rawExistingReportValues(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  return [
    prospect.callprep_report_url,
    prospect.callprepReportUrl,
    prospect.report_url,
    prospect.reportUrl,
    record.callprep_report_url,
    record.callprepReportUrl,
    record.report_url,
    record.reportUrl,
  ].filter((value) => value !== null && value !== undefined
    && (typeof value !== "string" || clean(value)));
}

function knownForeignReportUrl(value) {
  const raw = clean(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return /^https?:$/.test(parsed.protocol)
      && Boolean(host)
      && host !== CALLPREP_REPORT_HOST
      && !host.endsWith(`.${CALLPREP_REPORT_HOST}`);
  } catch {
    return false;
  }
}

async function withImmutableSaveFlight(save, packetId, create) {
  let flights = immutableSaveFlights.get(save);
  if (!flights) {
    flights = new Map();
    immutableSaveFlights.set(save, flights);
  }
  const current = flights.get(packetId);
  if (current) return current;

  const pending = Promise.resolve().then(create);
  flights.set(packetId, pending);
  try {
    return await pending;
  } finally {
    if (flights.get(packetId) === pending) flights.delete(packetId);
  }
}

async function raceReportWork(work, timeoutMs, code) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Project the already certified compiler packet into CallPrep's static adapter.
 * No mutable service/category hints are consulted. Offered services are not
 * Signal measurements, so they never become requestedSignals.
 */
function immutablePacketAdapter(prospect = {}, options = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const packet = record.genie_canonical_packet;
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return { ok: false, reason: "immutable_packet_missing" };
  }

  let verified;
  try {
    verified = verifyImmutablePacket(prospect, record, options);
  } catch {
    return { ok: false, reason: "immutable_packet_verification_failed" };
  }
  if (!verified || verified.ok !== true) {
    const suffix = clean(verified && verified.reason).replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 80);
    return { ok: false, reason: suffix ? `immutable_packet_unverified:${suffix}` : "immutable_packet_unverified" };
  }

  const reportPacketId = genieReportPacketId(verified.receipt);
  if (!reportPacketId) {
    return { ok: false, reason: "immutable_packet_identity_token_missing" };
  }

  const facts = packet.facts && typeof packet.facts === "object" ? packet.facts : {};
  const contractFacts = packet.content?.content_contract?.facts;
  const identity = verified.receipt && typeof verified.receipt.identity === "object"
    ? verified.receipt.identity
    : {};
  const category = clean(
    identity.category
      || facts.category
      || facts.vertical
      || packet.scope?.category
      || packet.scope?.vertical
      || (contractFacts && contractFacts.category),
  );
  const businessName = clean(identity.business_name || facts.name);
  const city = clean(identity.city || facts.city);
  const state = clean(identity.state || facts.state);
  const market = [city, state].filter(Boolean).join(", ");
  // This is an immutable certified-packet projection. The receipt is the only
  // authority for whether this business had a website at certification time.
  // In particular, an old mutable prospect URL must not turn a signed
  // website-less packet into a website report with a fictitious comparison.
  const signedDomainValue = clean(identity.canonical_domain);
  const signedDomain = reportDomain(signedDomainValue);
  if (signedDomainValue && !signedDomain) {
    return { ok: false, reason: "immutable_packet_identity_domain_invalid" };
  }
  const website = signedDomain ? `https://${signedDomain}/` : "";

  return {
    ok: true,
    adapter: {
      packet: {
        id: reportPacketId,
        businessName,
        market,
        industry: category,
        requestedSignals: [],
      },
    },
    // The owner-Practice Signal is a neutral projection of the certified
    // packet. Do not let mutable gaps, recommendations, ratings, or reviews
    // become a second post-packet grade/red-flag system.
    prospect: {
      business_name: businessName,
      businessName,
      city,
      state,
      industry: category,
      ...(website ? { current_website: website } : {}),
    },
    reportIdentity: {
      packetId: reportPacketId,
      businessName,
      domain: clean(identity.canonical_domain),
    },
  };
}

function immutableSaveMayHaveCreatedRow(saved) {
  if (!saved || typeof saved !== "object") return true;
  if (saved.configured === false) return false;
  const mode = clean(saved.mode).toLowerCase();
  return !new Set(["not_configured", "invalid_packet"]).has(mode);
}

function createdReportReconciliation(reportUrl, reason) {
  return {
    ok: false,
    reportUrl,
    // This URL is persistence-only until a later exact identity read returns
    // ok. Carrying it durably prevents a retry from minting a second row while
    // never authorizing it for an owner-proof email.
    persistReportUrl: reportUrl,
    mode: "immutable_packet",
    reason,
    retryable: true,
    retryableBeforeProvider: true,
    ambiguousSave: true,
    reconciliationRequired: true,
  };
}

/** The best scan key we have: their real site, else "Name City ST". */
function scanKeyFor(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const site = [
    prospect.currentWebsite, prospect.current_website, prospect.website,
    record.current_website, record.website, record.site_url,
  ].map((v) => String(v || "").trim()).find((v) => /^https?:\/\//i.test(v));
  if (site) return site;
  const name = String(prospect.business_name || record.business_name || "").trim();
  const city = String(prospect.city || record.city || "").trim();
  const state = String(prospect.state || record.state || "").trim();
  return [name, city, state].filter(Boolean).join(" ").trim();
}

/**
 * ensureLineReport(prospect, { closerId }) -> { ok, reportUrl, mode, reason }
 *
 * Reuses an existing report when the prospect already has one — the URL is the
 * prospect's own permanent record, and re-minting it on every resend would hand
 * the same business a different link each time.
 */
async function ensureLineReport(prospect = {}, {
  closerId = null,
  deps = {},
  deadlineAt = 0,
  now = Date.now,
  preferImmutablePacket = false,
} = {}) {
  const scan_ = deps.scanBusiness || scanBusiness;
  const saveScanned = deps.saveScannedBusinessReport || saveScannedBusinessReport;
  const saveStatic = deps.saveBusinessReport || saveBusinessReport;
  const existing = deps.existingCallPrepReportUrl || existingCallPrepReportUrl;
  const remaining = () => Number(deadlineAt) > 0
    ? Math.max(0, Number(deadlineAt) - Number(now()))
    : 15_000;

  let existingReadFailed = false;
  let existingValue = "";
  try {
    existingValue = existing ? existing(prospect) : "";
  } catch {
    existingReadFailed = true;
  }

  const rawExistingValues = rawExistingReportValues(prospect);
  const referenceValues = [existingValue, ...rawExistingValues]
    .filter((value) => value !== null && value !== undefined
      && (typeof value !== "string" || clean(value)));
  const canonicalCandidates = [...new Set(referenceValues
    .map(canonicalCallPrepReportUrl)
    .filter(Boolean))];
  const invalidExistingReference = referenceValues.some((value) => (
    !canonicalCallPrepReportUrl(value) && !knownForeignReportUrl(value)
  ));

  if (preferImmutablePacket === true && (existingReadFailed || invalidExistingReference)) {
    return {
      ok: false,
      reportUrl: "",
      mode: "existing",
      reason: existingReadFailed
        ? "existing_report_lookup_unavailable"
        : "existing_report_reference_invalid",
      reconciliationRequired: true,
    };
  }

  if (canonicalCandidates.length && preferImmutablePacket !== true) {
    // LEGACY REPORT SELF-HEAL: a report minted before identity stamping (or
    // via the scanned adapter, which never stamps one) can never satisfy the
    // owner-proof report-identity verdict at email time — the send dies with
    // owner_proof_signal_report_identity_missing forever. When the report
    // exists but carries no identity AND the certified genie receipt can
    // project the immutable identity, rebuild the permanent record ONCE
    // through the immutable adapter. Identity-carrying reports keep the
    // reuse fast path unchanged.
    let carried = false;
    if (deps.fetchReportFacts || !deps.scanBusiness) {
      const fetchFacts = deps.fetchReportFacts || require("./report-grade").fetchReportFacts;
      try {
        const facts = await fetchFacts({ reportUrl: canonicalCandidates[0] });
        const identity = facts && facts.identity && typeof facts.identity === "object"
          && !Array.isArray(facts.identity)
          ? facts.identity
          : null;
        carried = facts && facts.reportExists === true && Boolean(clean(identity && identity.packetId));
      } catch { /* fail soft: treat as identity-less and attempt the rebuild */ }
    }
    if (carried) return { ok: true, reportUrl: canonicalCandidates[0], mode: "existing" };
    const record_ = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
    const stripped = {
      ...prospect,
      callprep_report_url: "", callprepReportUrl: "", report_url: "", reportUrl: "",
      record: {
        ...record_,
        callprep_report_url: "", callprepReportUrl: "", report_url: "", reportUrl: "",
      },
    };
    const rebuilt = await ensureLineReport(stripped, {
      closerId, deps, deadlineAt, now, preferImmutablePacket: true,
    });
    if (rebuilt && rebuilt.ok === true) return { ...rebuilt, mode: "identity_rebuild" };
    if (rebuilt && rebuilt.reconciliationRequired === true && clean(rebuilt.persistReportUrl)) {
      return { ok: true, reportUrl: clean(rebuilt.persistReportUrl), mode: "identity_rebuild_persisting" };
    }
    // No certified packet to rebuild from: ordinary fail-soft reuse stands.
    return { ok: true, reportUrl: canonicalCandidates[0], mode: "existing" };
  }

  let projected = null;
  let readFacts = null;
  let clearReportFactsCache = null;
  if (preferImmutablePacket === true) {
    projected = immutablePacketAdapter(prospect, {
      verifyGenieContentReceipt: deps.verifyGenieContentReceipt,
      ...(Object.prototype.hasOwnProperty.call(deps, "certificationKey")
        ? { certificationKey: deps.certificationKey }
        : {}),
      nowMs: Number(now()),
    });
    if (!projected.ok) {
      return { ok: false, reportUrl: "", mode: "immutable_packet", reason: projected.reason };
    }
    readFacts = deps.fetchReportFacts || require("./report-grade").fetchReportFacts;
    clearReportFactsCache = deps.clearReportGradeCache
      || require("./report-grade").clearReportGradeCache;
  }

  if (canonicalCandidates.length && preferImmutablePacket === true) {
    const matches = [];
    const identityFailures = [];
    for (const reportUrl of canonicalCandidates) {
      if (remaining() < 1_000) {
        return {
          ok: false,
          reportUrl: "",
          mode: "existing",
          reason: "existing_report_availability_unknown",
          reconciliationRequired: true,
        };
      }
      let availability = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        availability = await readFacts({
          reportUrl,
          timeoutMs: Math.max(1_000, Math.min(15_000, remaining())),
          now,
        });
      } catch {
        return {
          ok: false,
          reportUrl: "",
          mode: "existing",
          reason: "existing_report_lookup_unavailable",
          reconciliationRequired: true,
        };
      }
      if (!availability || ![true, false].includes(availability.reportExists)) {
        return {
          ok: false,
          reportUrl: "",
          mode: "existing",
          reason: "existing_report_availability_unknown",
          reconciliationRequired: true,
        };
      }
      if (availability.reportExists === false) continue;
      const identityVerdict = existingReportIdentityVerdict(projected, availability);
      if (identityVerdict.ok) matches.push(reportUrl);
      else identityFailures.push(identityVerdict.reason);
    }

    if (matches.length === 1) return { ok: true, reportUrl: matches[0], mode: "existing" };
    return {
      ok: false,
      reportUrl: "",
      mode: "existing",
      reason: matches.length > 1
        ? "existing_report_identity_ambiguous"
        : (canonicalCandidates.length === 1 && identityFailures[0]
          ? identityFailures[0]
          : "existing_report_identity_no_match"),
      reconciliationRequired: true,
    };
  }

  if (preferImmutablePacket === true) {
    if (remaining() < 1_000) {
      return { ok: false, reportUrl: "", mode: "immutable_packet", reason: "report_deadline" };
    }
    try {
      return await withImmutableSaveFlight(saveStatic, projected.reportIdentity.packetId, async () => {
        const saveTimeoutMs = Math.max(1_000, Math.min(15_000, remaining()));
        const saved = await raceReportWork(
          () => saveStatic(
            {
              adapter: projected.adapter,
              prospect: projected.prospect,
              closerId,
              immutablePacketId: projected.reportIdentity.packetId,
            },
            { timeoutMs: saveTimeoutMs },
          ),
          saveTimeoutMs,
          "report_save_deadline",
        );
        const reportUrl = canonicalCallPrepReportUrl(saved && saved.ok ? saved.report_url : "");
        if (!reportUrl) {
          return {
            ok: false,
            reportUrl: "",
            mode: "immutable_packet",
            reason: (saved && saved.reason) || "invalid_report_url",
            ...(immutableSaveMayHaveCreatedRow(saved)
              ? { ambiguousSave: true, reconciliationRequired: true }
              : {}),
          };
        }

        if (remaining() < 1_000) {
          return createdReportReconciliation(reportUrl, "created_report_availability_unknown");
        }

        let createdAvailability = null;
        try {
          createdAvailability = await readFacts({
            reportUrl,
            timeoutMs: Math.max(1_000, Math.min(15_000, remaining())),
            now,
          });
        } catch { /* injected failures are handled as unknown */ }
        if (!createdAvailability || createdAvailability.reportExists !== true) {
          // A just-created UUID can briefly answer 404. report-grade normally
          // caches failures for ten minutes, which is correct for ordinary
          // composition but would make the durable retry replay stale absence
          // and never observe the row. Evict before returning the persistence-
          // only handle; the next prepare remains GET-only.
          if (typeof clearReportFactsCache === "function") clearReportFactsCache();
          return createdReportReconciliation(reportUrl, "created_report_availability_unknown");
        }
        const identityVerdict = existingReportIdentityVerdict(projected, createdAvailability);
        if (!identityVerdict.ok) {
          if (typeof clearReportFactsCache === "function") clearReportFactsCache();
          return createdReportReconciliation(
            reportUrl,
            identityVerdict.reason.replace(/^existing_/, "created_"),
          );
        }
        return { ok: true, reportUrl, mode: "immutable_packet" };
      });
    } catch (e) {
      return {
        ok: false,
        reportUrl: "",
        mode: "immutable_packet",
        reason: String((e && e.message) || e).slice(0, 160),
        ambiguousSave: true,
        reconciliationRequired: true,
      };
    }
  }

  const input = scanKeyFor(prospect);
  if (!input) return { ok: false, reportUrl: "", mode: "none", reason: "no_scan_key" };

  if (remaining() < 1_000) return { ok: false, reportUrl: "", mode: "none", reason: "report_deadline" };

  let scan = null;
  let scanError = "";
  try {
    scan = await scan_({ input }, {
      timeoutMs: Math.max(1_000, Math.min(15_000, remaining())),
      attempts: 1,
    });
  } catch (e) {
    scanError = String((e && e.message) || e).slice(0, 160);
  }

  try {
    const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
    const sourceAdapter = prospect.packet && typeof prospect.packet === "object"
      ? prospect
      : {
          packet: {
            businessName: prospect.businessName || prospect.business_name || record.business_name,
            market: prospect.market || [prospect.city || record.city, prospect.state || record.state]
              .map(clean).filter(Boolean).join(", "),
            industry: prospect.industry || record.industry,
            requestedSignals: [],
          },
        };
    const packet = customerSafePacket ? customerSafePacket(sourceAdapter, prospect) : null;
    if (remaining() < 1_000) return { ok: false, reportUrl: "", mode: "none", reason: "report_deadline" };
    const saveOptions = { timeoutMs: Math.max(1_000, Math.min(15_000, remaining())) };
    const saved = scan
      ? await saveScanned({ scan, prospect, closerId }, saveOptions)
      : await saveStatic({ adapter: { packet }, prospect, closerId }, saveOptions);
    const reportUrl = canonicalCallPrepReportUrl(saved && saved.ok ? saved.report_url : "");
    if (!reportUrl) {
      return { ok: false, reportUrl: "", mode: scan ? "live_scan" : "static", reason: (saved && saved.reason) || "invalid_report_url" };
    }
    return { ok: true, reportUrl, mode: scan ? "live_scan" : (scanError ? `static_fallback:${scanError}` : "static") };
  } catch (e) {
    return { ok: false, reportUrl: "", mode: "error", reason: String((e && e.message) || e).slice(0, 160) };
  }
}

module.exports = { ensureLineReport, immutablePacketAdapter, scanKeyFor };
