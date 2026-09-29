"use strict";

function prospectFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const embedded =
    row.record && typeof row.record === "object"
      ? row.record
      : row.payload && typeof row.payload === "object"
        ? row.payload
        : {};

  // Column values are the source of truth for status, URLs, IDs, and contact
  // fields because the JSON payload may be stale after pipeline updates.
  return {
    ...embedded,
    ...row,
  };
}

// A RECORD MUST NEVER CONTAIN A RECORD.
//
// prospectFromRow spreads the whole DB row on purpose — column values must win
// over stale JSON — which means the object it returns still carries `record`
// (and `payload`). Spreading that object into a NEW record nests the entire
// prior blob one level deeper, and the next save nests that again. Growth is
// geometric, and it is not theoretical: 333 of 1,122 prospect rows reached
// depth 6+, one at 21 MB, accounting for 106 MB of the 107 MB total record
// volume and 224 MB of TOAST. That single table was the reason the console's
// snapshot query burned 92.5% of all database time.
//
// Strip the container keys before persisting. Everything else passes through.
function recordForPersist(source) {
  if (!source || typeof source !== "object") return {};
  const { record, payload, ...rest } = source;
  return rest;
}

function firstValue(input, keys, fallback = "") {
  for (const key of keys) {
    const value = input && input[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

function slugify(value, fallback = "local-growth-lead") {
  const slug = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

function prospectId(prospect = {}) {
  return firstValue(prospect, ["prospect_id", "id"], slugify(prospect.business_name || prospect.businessName));
}

// WHERE A MINED LEAD'S LOGO ACTUALLY LIVES.
//
// The miner never writes a top-level `logo_url`. It writes the whole build-ready
// contract into record.build_ready, and the mark it verified lands in two places
// inside it: mirror_request.brand.logo — the exact request it dry-ran and proved
// — and brand_evidence.logo_url, the same URL beside the sha256 of the bytes and
// the accent measured from them.
//
// Two build entry points were reading two different places. The operator line
// (line-adapters.prospectFromContract) read the contract, so its mirrors wore
// the client's logo. The dashboard (full-run.prospectBuildInput) looked only at
// prospect.logo_url / record.logo_url, which a mined row simply does not have,
// so it sent mirror() no brand block at all and the engine answered
//     brand: "unbranded", logo: "wordmark-fallback", accent_origin: "none"
// for leads the miner had qualified BY fetching and measuring their logo.
// Measured 2026-08-06 on Simmons Plumbing and Mechanical LLC. (Albuquerque) and
// All Home Plumbing Co. (Chattanooga): both carried a real logo_url, logo_sha256
// and accent in build_ready.brand_evidence, and both built with a wordmark.
// brand is a required check for revealable, so those deploys could never be
// shown to anybody.
//
// One reader, so the two paths cannot drift apart again.
//
// The accent comes back for completeness, but callers should prefer letting the
// engine MEASURE it from the logo bytes it fetches: same number, and the check
// then records "measured_from_logo(...)" instead of "caller_supplied".
//
// `accent_source` — the file the accent was measured from — travels with it, and
// is returned ONLY when it was actually recorded. It is never inferred from the
// logo URL: the engine runs the third-party denylist over whatever is in this
// field, and a source we guessed is not a source we verified. Without it the
// accent cannot be used as a fallback at all, which is the correct, quiet
// outcome for an old row that never wrote one.
function verifiedBrandOf(source) {
  const empty = { logo: "", logo_sha256: "", accent: "", accent_source: "" };
  if (!source || typeof source !== "object") return empty;
  const record = source.record && typeof source.record === "object" ? source.record : source;

  // THE SHIPPED COLOUR OUTRANKS EVERY STORED ONE. record.brand_truth is the
  // accent the engine's own arbitration actually painted the mirror in —
  // written back from release_evidence.checks.brand at the build persistence
  // points (see brandTruthFromEvidence below). The contract's accent is what
  // the miner MEASURED before the build; when the engine then decided the
  // site's chrome was the better witness (the 2026-08-12 Family Heating call),
  // the mirror wears one colour and the contract still records the other.
  // Every reader below this line gets the colour the customer actually sees,
  // which is the whole point of being the single reader. Only the NUMBER is
  // upgraded: logo and accent_source keep their verified provenance, because a
  // decision label is not a file the denylist can run over.
  const truth = record.brand_truth && typeof record.brand_truth === "object" ? record.brand_truth : null;
  const truthAccent = truth && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(String(truth.accent || "").trim())
    ? String(truth.accent).trim()
    : "";

  // build_ready is `true` (a boolean flag) on LeadMiner truth-packet rows and a
  // contract object on mined ones, so the type check is doing real work here.
  const observed = record.last_mine_observation;
  const contracts = [record.build_ready, observed && observed.build_ready]
    .filter((candidate) => candidate && typeof candidate === "object");
  for (const contract of contracts) {
    const request = contract.mirror_request && typeof contract.mirror_request === "object"
      ? contract.mirror_request
      : {};
    const brand = request.brand && typeof request.brand === "object" ? request.brand : {};
    const evidence = contract.brand_evidence && typeof contract.brand_evidence === "object"
      ? contract.brand_evidence
      : {};
    const logo = firstValue(brand, ["logo"], "") || firstValue(evidence, ["logo_url"], "");
    if (!logo) continue;
    return {
      logo,
      logo_sha256: firstValue(brand, ["logo_sha256"], "") || firstValue(evidence, ["logo_sha256"], ""),
      accent: truthAccent || firstValue(brand, ["accent"], "") || firstValue(evidence, ["accent"], ""),
      accent_source: firstValue(brand, ["accent_source"], "") || firstValue(evidence, ["accent_source"], ""),
    };
  }

  // Rows that predate the contract — and hand-made ones — keep the flat shape.
  return {
    logo: firstValue(source, ["logo_url", "logo"], "") || firstValue(record, ["logo_url", "logo"], ""),
    logo_sha256: firstValue(source, ["logo_sha256"], "") || firstValue(record, ["logo_sha256"], ""),
    accent: truthAccent
      || firstValue(source, ["brand_color", "primary_color"], "")
      || firstValue(record, ["brand_color", "primary_color"], ""),
    accent_source: "",
  };
}

// THE COLOUR THE BUILD ACTUALLY SHIPPED, distilled from its own signed
// evidence into a small durable field.
//
// The engine's arbitration (lib/mirror-engine/brand-assets.js, site-chrome vs
// logo) can ship a mirror in a colour that exists NOWHERE in the record's
// brand fields — it lived only inside release_evidence.checks.brand, a
// manifest the email side never opens. So the site wore the decided colour
// while the email dressed itself from the miner's earlier measurement: the
// third divergence of the 2026-08-03 family. This distils the decision into
// record.brand_truth = { accent, source, secondary_accent?, decided_at } at
// the build persistence points (full-run's mergedRecord, line-adapters'
// mirrorRecordPatch), and verifiedBrandOf above prefers it FIRST — one
// reader, so the two surfaces cannot drift apart again.
//
// Null is an honest answer, never a guess: evidence that carries no shipped
// hex (a refused build, a pre-weld manifest with neither accent_hex nor an
// accent_decision) writes nothing, and whatever brand_truth the record
// already holds stays untouched.
function brandTruthFromEvidence(evidence, { decidedAt = "" } = {}) {
  const body = evidence && typeof evidence === "object" ? evidence : null;
  const checks = body && body.checks && typeof body.checks === "object" ? body.checks : null;
  const brand = checks && checks.brand && typeof checks.brand === "object" ? checks.brand : null;
  if (!brand) return null;
  const hexOf = (value) => {
    const hex = String(value || "").trim();
    return /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(hex) ? hex : "";
  };
  const decision = brand.accent_decision && typeof brand.accent_decision === "object"
    ? brand.accent_decision
    : null;
  // checks.brand.accent_hex is the exact hex the recolor loop painted with
  // (engine.js writes it beside the "measured"/"donor-default" label).
  // Evidence written before that field exists still names the winner's hex
  // inside accent_decision, so those rows are not orphaned.
  const accent = hexOf(brand.accent_hex)
    || (decision && decision.winner === "site_chrome" ? hexOf(decision.site) : "")
    || (decision && decision.winner === "logo" ? hexOf(decision.logo) : "");
  if (!accent) return null;
  const out = {
    accent,
    // WHY this colour won, carried as a label a human can read on the row:
    // the arbitration's own verdict when one was recorded, else the engine's
    // accent_origin string ("measured_from_logo(...)", "declared_in_logo_svg").
    source: decision && decision.winner
      ? `accent_decision:${String(decision.winner)}`
      : String(brand.accent_origin || "unknown"),
    decided_at: String(decidedAt || "").trim() || new Date().toISOString(),
  };
  const secondary = hexOf(brand.secondary_accent);
  if (secondary) out.secondary_accent = secondary;
  return out;
}

module.exports = {
  brandTruthFromEvidence,
  firstValue,
  prospectFromRow,
  prospectId,
  recordForPersist,
  slugify,
  verifiedBrandOf,
};
