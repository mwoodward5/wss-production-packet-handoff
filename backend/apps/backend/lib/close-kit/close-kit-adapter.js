'use strict';

/**
 * close-kit-adapter.js — lane record -> CloseKitInput.
 *
 * The Close Kit modules (close-kit-proposal.js, close-kit-onboarding.js,
 * close-kit-objections.js — student-built, contract-first) all speak ONE
 * input shape. This adapter is the only file that knows where those facts
 * live on a lane record, so the Close Kit never learns our schema.
 *
 * Laws:
 * - NEVER throws: any record shape (null, hostile, missing) returns
 *   { ok: false, warnings } or a partial { ok: true, input, warnings }.
 * - Omits + warns: a fact that is not on the record is simply absent from
 *   the CloseKitInput, with one human-readable warning line per gap.
 * - No invention: only observed fields cross this boundary. Nothing is
 *   defaulted except offer, which carries the factory price by decree.
 *
 * Self-test: node close-kit-adapter.js --test
 */

function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function str(v) { return typeof v === "string" ? v.trim() : ""; }
function num(v) {
  if (v == null || v === "") return null; // undefined is MISSING, not zero
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** The lane's offer is a decree, not a discovery. */
function defaultOffer() { return { monthly: 149, setup: 0, currency: "USD" }; }

function recordToCloseKitInput(record) {
  const warnings = [];
  if (!isObject(record)) return { ok: false, warnings: ["record is not an object — nothing to adapt"], input: null };

  // Facts live under build_ready.mirror_request.facts; older rows carry them
  // at the top level. Read both, prefer the nested contract.
  const contract = isObject(record.build_ready) && isObject(record.build_ready.mirror_request)
    ? record.build_ready.mirror_request : {};
  const facts = isObject(contract.facts) ? contract.facts : (isObject(record.facts) ? record.facts : {});
  const content = isObject(contract.content) ? contract.content : (isObject(record.content) ? record.content : {});

  const business = {
    name: str(facts.business_name) || str(record.business_name),
    city: str(facts.city),
    state: str(facts.state),
    phone: str(facts.phone),
    email: str(facts.email),
    website: str(facts.current_website) || str(facts.website),
  };
  if (!business.name) warnings.push("facts.business_name missing — proposal headline will omit");
  if (!business.city) warnings.push("facts.city missing — location lines will omit");
  if (!business.phone) warnings.push("facts.phone missing — letterhead phone will omit");

  // services: content.services rows are { name, description? }; plain strings
  // are tolerated. Generated rows are already filtered upstream; here we only
  // take names that survive as non-empty strings.
  const services = (Array.isArray(content.services) ? content.services : [])
    .map((s) => (typeof s === "string" ? str(s) : isObject(s) ? str(s.name) : ""))
    .filter(Boolean);
  if (!services.length) warnings.push("content.services empty — service list sections will omit");

  // reviews: content.reviews rows are objects; the quote text has worn
  // different keys across eras, so accept text|quote|comment. GBP carries the
  // counts even when quotes were withheld.
  const sampleQuotes = (Array.isArray(content.reviews) ? content.reviews : [])
    .map((r) => (isObject(r) ? str(r.text) || str(r.quote) || str(r.comment) : ""))
    .filter(Boolean)
    .slice(0, 3);
  const reviews = {
    count: num(facts.review_count) != null ? num(facts.review_count) : 0,
    rating: num(facts.rating) != null ? num(facts.rating) : 0,
    sampleQuotes,
  };
  if (!reviews.count) warnings.push("facts.review_count missing — reputation sections will omit");

  // gap: flatnessScore is measured by miner-retarget but has worn several
  // homes on records. Probe the known homes; absent means absent.
  const gapHomes = [
    isObject(record.mine_plan) ? record.mine_plan : null,
    isObject(record.website_probe) ? record.website_probe : null,
    isObject(record.discovery) ? record.discovery : null,
    isObject(record.build_ready) ? record.build_ready.discovery : null,
  ].filter(Boolean);
  let flatness = null;
  for (const home of gapHomes) {
    const v = num(home.flatnessScore) != null ? num(home.flatnessScore) : num(home.flatness_score);
    if (v != null) { flatness = v; break; }
  }
  const gap = flatness != null
    ? { flatnessScore: flatness, notes: [] }
    : { flatnessScore: 0, notes: [] };
  if (flatness == null) warnings.push("flatnessScore not found on record — gap section will omit");

  // proof: the JOB 5 contract — both captures present means the before/after
  // is real and identity-checked; anything less means it is not shown.
  const shots = isObject(record.proof_shots) ? record.proof_shots : {};
  const beforeUrl = str(shots.old_captured_url);
  const afterUrl = str(shots.new_captured_url);
  const proof = { beforeUrl, afterUrl, ready: Boolean(beforeUrl && afterUrl) };
  if (!proof.ready) warnings.push("proof_shots incomplete — before/after proof section will omit");

  const input = { business, services, reviews, gap, proof, offer: defaultOffer() };
  const ok = Boolean(business.name || services.length || reviews.count);
  if (!ok) warnings.push("no usable facts found — record is not close-kit-adaptable");
  return { ok, input, warnings };
}

module.exports = { recordToCloseKitInput, defaultOffer };

/* ---------------- self-test ---------------- */
if (process.argv.includes("--test")) {
  const t = require("node:assert");
  const cases = [];
  const ok = (name, fn) => { try { fn(); cases.push(`PASS ${name}`); } catch (e) { cases.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

  const full = {
    build_ready: { mirror_request: {
      facts: { business_name: "Bill Smith Plumbing & Heating", city: "Englewood", state: "CO", phone: "(303) 555-0123", email: "billsmith@example.com", current_website: "https://billsmith-plumbing.com", review_count: 214, rating: 4.8 },
      content: { services: [{ name: "Water heater install" }, { name: "Sewer repair" }], reviews: [{ text: "Same-day fix, fair price." }] },
    } },
    proof_shots: { old_captured_url: "https://old.example/x.png", new_captured_url: "https://new.example/y.png" },
    mine_plan: { flatnessScore: 87 },
  };

  ok("full record adapts clean", () => {
    const r = recordToCloseKitInput(full);
    t.equal(r.ok, true);
    t.equal(r.input.business.name, "Bill Smith Plumbing & Heating");
    t.equal(r.input.reviews.count, 214);
    t.deepEqual(r.input.services, ["Water heater install", "Sewer repair"]);
    t.equal(r.input.gap.flatnessScore, 87);
    t.equal(r.input.proof.ready, true);
    t.equal(r.input.offer.monthly, 149);
    t.equal(r.warnings.length, 0);
  });
  ok("null record fails soft", () => {
    const r = recordToCloseKitInput(null);
    t.equal(r.ok, false);
    t.ok(r.warnings.length >= 1);
  });
  ok("empty record fails soft with reasons", () => {
    const r = recordToCloseKitInput({});
    t.equal(r.ok, false);
    t.ok(r.warnings.some((w) => /review_count/.test(w)));
  });
  ok("partial proof means not ready", () => {
    const r = recordToCloseKitInput({ ...full, proof_shots: { old_captured_url: "https://old.example/x.png" } });
    t.equal(r.input.proof.ready, false);
  });
  ok("flatness probed across homes", () => {
    const r = recordToCloseKitInput({ ...full, mine_plan: undefined, website_probe: { flatness_score: 64 } });
    t.equal(r.input.gap.flatnessScore, 64);
  });
  ok("hostile keys do not pollute", () => {
    const evil = JSON.parse('{"__proto__": {"x": 1}, "build_ready": {"mirror_request": {"facts": {"business_name": "A"}}}}');
    const r = recordToCloseKitInput(evil);
    t.equal(({}).x, undefined);
    t.equal(r.ok, true);
  });
  ok("top-level fallback facts still read", () => {
    const r = recordToCloseKitInput({ facts: { business_name: "Solo Shop", review_count: "31" } });
    t.equal(r.input.business.name, "Solo Shop");
    t.equal(r.input.reviews.count, 31);
  });
  for (const c of cases) console.log(c);
  process.exit(process.exitCode || 0);
}
