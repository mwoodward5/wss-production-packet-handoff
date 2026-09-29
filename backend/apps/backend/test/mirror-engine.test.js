"use strict";

// test/mirror-engine.test.js — Mirror Engine acceptance tests (spec §10 tests
// 1-8 + review test 9), all runnable in CI with ZERO deploy budget: dry_run
// for the hydrate/scan path, injected deploy stubs for the ordering and
// fail-closed guarantees.
//
// Permanent adversarial fixture: O'Brien & Sons "Quality" Roofing $ave —
// no rating, no reviews, no license, no owner. The full gnarly name carries
// forbidden characters (" and $) and MUST be rejected at the boundary
// (invalid_facts) — that rejection IS the escaping defense. The buildable
// variant (apostrophe + ampersand only) exercises boundary normalization,
// optional collapse, and TRUTH LAW simultaneously.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// GATE 4C: fixture clients must never be stamped into the real client registry
// — a test phone stamped onto a live slug would refuse that client's next build.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-"));

const { mirror, signEvidence, RENDERER, EVIDENCE_SCHEMA, QC_CONTRACT } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS, generatedDocs, TOKEN_DEFS } = require("../lib/mirror-engine/tokens");
const { derivePhoneDigits, validateFacts } = require("../lib/mirror-engine/facts");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { chooseBrandMark } = require("../lib/mirror-engine/logo-ladder");
const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const forge = require("../lib/forge");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const OBRIEN_ADVERSARIAL_NAME = 'O\'Brien & Sons "Quality" Roofing $ave';

function obrienRequest(overrides = {}) {
  return {
    slug: "wss-test-obrien-and-sons-roofing",
    donor: "mirror-donor",
    facts: {
      business_name: "O'Brien & Sons Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
      ...(overrides.facts || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "facts")),
  };
}

/** Deploy/render stubs with a call log, so ordering is assertable. */
function makeDeps({ byteDiffClean = true, deepLinkClean = true, deepLinkReason = "http_404", renderStatus = "passed", routeAuditStatus = "passed" } = {}) {
  const calls = [];
  let captured = null;
  let deploymentInput = null;
  return {
    calls,
    files: () => captured,
    deploymentInput: () => deploymentInput,
    deps: {
      slugPolicy,
      withSpaRewrite: (files) => {
        const out = files["vercel.json"] ? files : { ...files, "vercel.json": Buffer.from('{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}') };
        captured = out;
        return out;
      },
      ensureProject: async (name) => { calls.push(["ensureProject", name]); return "prj_stub_123"; },
      resolveAliasDeployment: async () => { calls.push(["resolveAliasDeployment"]); return { found: false, reason: "alias_not_found" }; },
      uploadFiles: async (files) => {
        calls.push(["uploadFiles", Object.keys(files).length]);
        return { manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 3, deduped: Object.keys(files).length - 3 };
      },
      createDeployment: async (input) => {
        deploymentInput = input;
        calls.push(["createDeployment"]);
        return { id: "dpl_stub_1", url: "stub-deploy.vercel.app", readyState: "QUEUED" };
      },
      waitReady: async (id) => { calls.push(["waitReady", id]); return { readyState: "READY" }; },
      byteDiff: async () => {
        calls.push(["byteDiff"]);
        return byteDiffClean ? { clean: true, checked: 9, mismatches: [] } : { clean: false, checked: 9, mismatches: [{ file: "index.html", reason: "bytes_differ" }] };
      },
      deepLinkCheck: async () => {
        calls.push(["deepLinkCheck"]);
        return deepLinkClean ? { clean: true, failures: [] } : { clean: false, failures: [{ probe: "spa_deep_link", reason: deepLinkReason }] };
      },
      attachAlias: async ({ slug }) => { calls.push(["attachAlias", slug]); return { alias: `https://${slug}.wss-ai.com` }; },
      aliasTargetCheck: async ({ deployId }) => { calls.push(["aliasTargetCheck", deployId]); return { clean: true, deploymentId: deployId }; },
      renderCheck: async (url) => {
        calls.push(["renderCheck", url]);
        if (renderStatus === "unavailable") return { status: "unavailable", reason: "playwright_not_installed" };
        if (renderStatus === "failed") return { status: "failed", problems: ["console_errors:2"] };
        return { status: "passed", problems: [], video: { present: true, readyState: 4, paused: false } };
      },
      renderAudit: async (base, opts) => {
        calls.push(["renderAudit", base, (opts.paths || []).length]);
        if (routeAuditStatus === "unavailable") return { status: "unavailable", reason: "playwright_not_installed" };
        if (routeAuditStatus === "failed") {
          return { status: "failed", problems: ["route_collisions:/services=/services/gutters"], collisions: [["/services", "/services/gutters"]], pages: [], prose: [] };
        }
        return { status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary: the adversarial fixture name is rejected, the buildable one builds
// ---------------------------------------------------------------------------
test("adversarial O'Brien full name is rejected at the boundary (escaping defense)", async () => {
  const res = await mirror(obrienRequest({ facts: { business_name: OBRIEN_ADVERSARIAL_NAME } }), { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "invalid_facts");
  assert.ok(res.body.detail.some((d) => d.reason === "forbidden_characters"));
});

test("phone extension is rejected, never sliced to a wrong live number", () => {
  const r = derivePhoneDigits("(509) 842-6611 x102");
  assert.equal(r.ok, false);
  assert.match(r.reason, /extension/);
  const good = derivePhoneDigits("+1 (520) 555-0142");
  assert.deepEqual(good, { ok: true, digits: "5205550142" });
});

test("coordinate typo outside the state bbox is rejected (Spokane-in-China)", async () => {
  const bad = await mirror(obrienRequest({ facts: { state: "WA", latitude: 47.6588, longitude: 117.426 } }), { dryRun: true, registry: createRegistry() });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.detail.some((d) => String(d.reason).includes("coordinates_outside_state")));
  const good = await mirror(obrienRequest({ facts: { state: "WA", city: "Spokane", latitude: 47.6588, longitude: -117.426 } }), { dryRun: true, registry: createRegistry() });
  assert.equal(good.status, 200);
});

test("schema is strict: unknown fields, coercion, lowercase state all 400", async () => {
  for (const req of [
    { ...obrienRequest(), surprise: true },
    obrienRequest({ facts: { rating: "4.8" } }),
    obrienRequest({ facts: { state: "az" } }),
    { ...obrienRequest(), brand: { accent: "#fd7e00" } }, // accent without accent_source
    { ...obrienRequest(), brand: { ink: "#111111" } },    // ink dropped from v1
  ]) {
    const res = await mirror(req, { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 400, JSON.stringify(req).slice(0, 80));
    assert.equal(res.body.error, "invalid_request");
  }
});

// ---------------------------------------------------------------------------
// Acceptance tests 1-6 via dry_run (zero Vercel calls)
// ---------------------------------------------------------------------------
test("dry_run: manifest + build_hash + signed evidence, revealable false", async () => {
  const res = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
  assert.equal(res.status, 200);
  const m = res.body;
  assert.equal(m.dry_run, true);
  assert.equal(m.renderer, RENDERER);
  assert.equal(m.qc_contract, QC_CONTRACT);
  assert.equal(m.evidence_schema, EVIDENCE_SCHEMA);
  assert.match(m.build_hash, /^[0-9a-f]{64}$/);
  assert.match(m.donor_content_hash, /^[0-9a-f]{64}$/);
  assert.equal(m.checks.hydration_parse.status, "passed");
  assert.equal(m.checks.token_scan.status, "passed");
  assert.equal(m.checks.identity_scan.status, "passed");
  assert.equal(m.revealable, false, "dry_run output must never be revealable");
  assert.match(m.evidence_sha, /^[0-9a-f]{64}$/);
});

test("dry_run build_hash is deterministic; donor drift changes it", async () => {
  const a = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
  const b = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
  assert.equal(a.body.build_hash, b.body.build_hash);
  const c = await mirror(obrienRequest({ facts: { rating: 4.8, review_count: 12 } }), { dryRun: true, registry: createRegistry() });
  assert.notEqual(a.body.build_hash, c.body.build_hash);
});

test("signup checkout bytes participate in build_hash but never deployment metadata", async () => {
  const checkoutOne = "https://ghost.wss-ai.com/api/checkout-link?token=signed-one&sig=secret-one";
  const checkoutTwo = "https://ghost.wss-ai.com/api/checkout-link?token=signed-two&sig=secret-two";
  const signup = {
    clientId: "obrien-roofing",
    rileyTel: "+15205550142",
    rileyDisplay: "(520) 555-0142",
    checkoutUrl: checkoutOne,
    domain: "wss-test-obrien-and-sons-roofing.wss-ai.com",
    price: "$299",
  };
  const request = obrienRequest({ content: { services: ["Roof repair"] }, signup });
  const first = await mirror(request, { dryRun: true, registry: createRegistry() });
  const same = await mirror(request, { dryRun: true, registry: createRegistry() });
  const reordered = await mirror(obrienRequest({
    content: { services: ["Roof repair"] },
    signup: Object.fromEntries(Object.entries(signup).reverse()),
  }), { dryRun: true, registry: createRegistry() });

  assert.equal(first.status, 200);
  assert.equal(same.body.build_hash, first.body.build_hash);
  assert.equal(reordered.body.build_hash, first.body.build_hash, "signup key order changed the canonical hash");
  const changes = {
    clientId: "obrien-roofing-two",
    rileyTel: "+15205550143",
    rileyDisplay: "(520) 555-0143",
    checkoutUrl: checkoutTwo,
    domain: "other-obrien-roofing.wss-ai.com",
    price: "$399",
  };
  for (const [field, value] of Object.entries(changes)) {
    const changed = await mirror(obrienRequest({
      content: { services: ["Roof repair"] },
      signup: { ...signup, [field]: value },
    }), { dryRun: true, registry: createRegistry() });
    assert.notEqual(changed.body.build_hash, first.body.build_hash, `${field} did not move build_hash`);
  }
  assert.equal(JSON.stringify(first.body).includes(checkoutOne), false, "raw checkout URL leaked into evidence");

  const harness = makeDeps();
  const deployed = await mirror(request, { registry: createRegistry(), deps: harness.deps });
  assert.equal(deployed.status, 200, JSON.stringify(deployed.body).slice(0, 300));
  assert.deepEqual(harness.deploymentInput().metadata, { build_hash: deployed.body.build_hash });
  assert.equal(JSON.stringify(harness.deploymentInput().metadata).includes(checkoutOne), false);
});

test("tests 1/4/5/6: hydrated OUTPUT is checked — collapse, truth law, tokens, geography", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  const out = files();
  const html = out["index.html"].toString("utf8");

  // Boundary normalization: curly apostrophe, never a straight one in a name.
  assert.ok(html.includes("O’Brien & Sons Roofing"), "normalized business name renders");
  // Test 4: review slots collapse when unverified; no invented reviewer.
  assert.ok(!html.includes("stars from"), "review-proof block collapsed");
  assert.ok(!html.includes("review-slot"), "review quote slot collapsed");
  assert.ok(!html.includes("Meet the owner"), "owner block collapsed when owner unknown");
  assert.ok(!html.includes("Licensed:"), "license line collapsed");
  assert.ok(!html.includes("data-collapse-if-empty"), "collapse markers never ship");
  // Test 5: state/city come from the prospect.
  assert.ok(html.includes("Tucson, AZ"));
  assert.ok(!html.includes("Tucson, WA"));
  // Phone policy: every tel: href equals the validated 10-digit form.
  for (const m of html.matchAll(/tel:([^"']+)/g)) assert.equal(m[1], "5205550142");
  // Test 6: zero raw tokens in ANY hydrated file.
  for (const [rel, buf] of Object.entries(out)) {
    if (!/\.(html|js|css|json|txt|svg|xml|webmanifest)$/i.test(rel)) continue;
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(buf.toString("utf8")), `raw token in ${rel}`);
  }
  // JS chunk hydrated too (GOTCHA-2) and still parses.
  const js = out["assets/app-abc123.js"].toString("utf8");
  assert.ok(js.includes("O’Brien & Sons Roofing"));
  require("acorn").parse(js, { ecmaVersion: "latest", sourceType: "module" });
  // Wordmark present; binary media passed through byte-identical.
  assert.ok(out["assets/brand-logo.svg"]);
  const donorBytes = fs.readFileSync(path.join(__dirname, "fixtures", "mirror-donor", "media", "hero-loop.mp4"));
  assert.ok(out["media/hero-loop.mp4"].equals(donorBytes));
  // vercel.json SPA rewrite injected.
  assert.ok(out["vercel.json"], "SPA rewrite injected");
});

test("a content-free engine build still puts visitor chat on every future HTML page", async () => {
  // Both LeadMiner and resolver builds converge on engine.mirror(). Proving the
  // common seam is stronger than duplicating two request-builder tests: this
  // request intentionally has NO content, the exact branch that used to skip
  // content-inject and therefore every site-wide chat surface.
  const { deps, files } = makeDeps();
  const request = obrienRequest();
  assert.equal(request.content, undefined);
  const res = await mirror(request, { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));

  const out = files();
  const htmlPages = Object.keys(out).filter((rel) => /\.html$/i.test(rel)).sort();
  assert.ok(htmlPages.includes("index.html"));
  assert.ok(htmlPages.includes("404.html"), "the real generated 404 is a visitor contact surface too");
  for (const rel of htmlPages) {
    const html = out[rel].toString("utf8");
    assert.equal((html.match(/id=["']wss-chat-root["']/g) || []).length, 1, `${rel} gets exactly one widget`);
    assert.equal((html.match(/id=["']wss-chat-config["']/g) || []).length, 1, `${rel} gets exactly one route stamp`);
    assert.ok(html.includes('"slug":"wss-test-obrien-and-sons-roofing"'), `${rel} is pinned to its build slug`);
    assert.doesNotMatch(html, /id=["']wss-content["']|data-wss-content=/, "chat-only must not pretend verified content exists");
  }

  const check = res.body.checks.content;
  assert.equal(check.status, "none");
  assert.equal(check.sections, 0);
  assert.equal(check.chat_widget.present, true);
  assert.equal(check.chat_widget.pages, htmlPages.length);
  assert.ok(check.chat_widget.bytes > 1000);
  assert.equal(out["llms.txt"], undefined, "the narrow empty-content repair does not run the full SEO/content injector");
  assert.equal(out["sitemap.xml"], undefined, "chat alone does not fabricate a content sitemap");
});

test("authority pages created after the full content pass also get exactly one visitor chat", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(obrienRequest({
    content: {
      services: [{ name: "Roof repair", description: "Repairs for verified roof damage." }],
      faqs: [{ q: "Do you inspect roofs?", a: "Yes, by appointment." }],
      areas: ["Tucson"],
      about: "O’Brien & Sons Roofing serves Tucson homeowners.",
    },
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  const out = files();
  const htmlPages = Object.keys(out).filter((rel) => /\.html$/i.test(rel)).sort();
  for (const expected of ["index.html", "about.html", "faq.html", "service-areas.html", "404.html"]) {
    assert.ok(htmlPages.includes(expected), `${expected} was not generated`);
  }
  for (const rel of htmlPages) {
    const html = out[rel].toString("utf8");
    assert.equal((html.match(/id=["']wss-chat-root["']/g) || []).length, 1, `${rel} gets exactly one final-pass widget`);
  }
  assert.equal(res.body.checks.content.chat_widget.pages, htmlPages.length);
  assert.equal(res.body.checks.content.chat_widget.present, true);
});

test("owner block is KEPT (marker stripped) when owner_name is verified", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(obrienRequest({ facts: { owner_name: "Pat O'Brien" } }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  const html = files()["index.html"].toString("utf8");
  assert.ok(html.includes("Meet the owner"));
  assert.ok(html.includes("Pat O’Brien"));
  assert.ok(!html.includes("data-collapse-if-empty"));
});

// ---------------------------------------------------------------------------
// Tests 2/3: donor identity + donor brand assets can never survive
// ---------------------------------------------------------------------------
test("tests 2/3: leaky donor is blocked — person name, phone, city, brand asset", async () => {
  const res = await mirror(
    obrienRequest({ donor: "mirror-donor-leaky", facts: { city: "Phoenix" } }),
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "donor_identity_detected");
  const buckets = new Set(res.body.detail.map((h) => h.bucket));
  assert.ok(buckets.has("socials") || buckets.has("name"), "donor person/company name flagged");
  assert.ok(buckets.has("donor_brand_asset"), "donor logo file flagged (pixels, not text)");
});

test("unmapped donor token hard-fails (422 unmapped_token)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-donor-"));
  const dir = path.join(root, "unmapped-donor");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "BOILERPLATE.json"), JSON.stringify({ name: "unmapped-donor", vertical: "roofing" }));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body><h1>{{HERO_LINE_EXTRA_UNKNOWN}}</h1></body></html>");
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = root;
  try {
    const res = await mirror(obrienRequest({ donor: "unmapped-donor" }), { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, "unmapped_token");
  } finally {
    process.env.MIRROR_DONOR_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 9: post-hydration parse gate
// ---------------------------------------------------------------------------
test("test 9: a value that breaks a JS literal is caught by the parse gate", () => {
  const donorFiles = {
    "assets/app.js": Buffer.from("const B = { name: '{{BUSINESS_NAME}}' };\nexport default B;"),
    "index.html": Buffer.from("<!doctype html><html><body>{{BUSINESS_NAME}}<a href=\"tel:{{PHONE_DIGITS}}\">{{PHONE}}</a>{{CITY}} {{STATE}} {{REGION}} {{HERO_HEADLINE}}</body></html>"),
  };
  const tokenValues = Object.fromEntries([...ALLOWED_TOKENS].map((t) => [t, ""]));
  Object.assign(tokenValues, {
    BUSINESS_NAME: "Mike's Roofing", // straight apostrophe forced past the boundary
    PHONE: "(520) 555-0142", PHONE_DIGITS: "5205550142",
    CITY: "Tucson", ADDRESS_CITY: "Tucson", STATE: "AZ", REGION: "AZ", HERO_HEADLINE: "Roofing in Tucson.",
  });
  const res = hydrate({ donorFiles, tokenValues });
  assert.equal(res.ok, false);
  assert.equal(res.error, "hydration_parse_failed");
  assert.equal(res.detail[0].file, "assets/app.js");
});

// ---------------------------------------------------------------------------
// Idempotency, slug conflict, locks
// ---------------------------------------------------------------------------
test("memo: identical request replays without a second deploy", async () => {
  const registry = createRegistry();
  const first = makeDeps();
  const res1 = await mirror(obrienRequest(), { registry, deps: first.deps });
  assert.equal(res1.status, 200);
  const second = makeDeps();
  const res2 = await mirror(obrienRequest(), { registry, deps: second.deps });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.idempotent_replay, true);
  assert.equal(second.calls.length, 0, "no Vercel call on memo hit");
});

test("a build whose browser never opened is NOT memoised", async () => {
  // "unavailable" is not a verdict — it is the proof stage saying it never ran.
  // Caching it froze one lost /tmp extraction race into a permanent answer for
  // that build_hash: every later attempt on the same warm instance replayed
  // `idempotent_replay: true` in milliseconds without opening a browser, and
  // the lead could not recover until the instance died. That is how a ten-lead
  // run stays at 3/10 even after the flake has passed.
  const registry = createRegistry();
  const blind = makeDeps({ renderStatus: "unavailable", routeAuditStatus: "unavailable" });
  const res1 = await mirror(obrienRequest(), { registry, deps: blind.deps });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.revealable, false);
  assert.equal(res1.body.checks.render.status, "unavailable");

  // The flake passes; the very next attempt must actually BUILD again.
  const sighted = makeDeps();
  const res2 = await mirror(obrienRequest(), { registry, deps: sighted.deps });
  assert.equal(res2.body.idempotent_replay, undefined, "a build that was never looked at is not an answer to replay");
  assert.ok(sighted.calls.length > 0, "the retry must reach Vercel and render for real");
  assert.equal(res2.body.checks.render.status, "passed");

  // A build that WAS looked at and failed on its own bytes still memoises —
  // that contract is unchanged, because a dead link is dead on every render.
  const seen = createRegistry();
  const judged = makeDeps({ renderStatus: "failed" });
  await mirror(obrienRequest(), { registry: seen, deps: judged.deps });
  const replay = makeDeps({ renderStatus: "failed" });
  const res3 = await mirror(obrienRequest(), { registry: seen, deps: replay.deps });
  assert.equal(res3.body.idempotent_replay, true);
  assert.equal(replay.calls.length, 0);
});

test("409 slug_conflict: same slug, different business", async () => {
  const registry = createRegistry();
  await mirror(obrienRequest(), { dryRun: true, registry });
  const res = await mirror(obrienRequest({ facts: { business_name: "Totally Different Plumbing" } }), { dryRun: true, registry });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "slug_conflict");
  // Legitimate re-mirror (same business, new facts) is allowed.
  const re = await mirror(obrienRequest({ facts: { rating: 4.9, review_count: 31 } }), { dryRun: true, registry });
  assert.equal(re.status, 200);
});

// ---------------------------------------------------------------------------
// Deploy path guarantees (stubbed — ordering, fail-closed, reveal gating)
// ---------------------------------------------------------------------------
test("ALIAS LAST: byte-diff failure blocks the alias entirely", async () => {
  const { deps, calls } = makeDeps({ byteDiffClean: false });
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "deployed_verification_failed");
  assert.ok(!calls.some(([name]) => name === "attachAlias"), "alias must never run after a failed diff");
});

test("fresh-deploy TRANSIENT probe 5xx is retryable (502), not a terminal 500", async () => {
  const { deps } = makeDeps({ deepLinkClean: false, deepLinkReason: "http_503" });
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 502, "a momentary 503 on a fresh deploy must be retryable");
  assert.equal(res.body.error, "vercel_error");
  assert.match(res.body.detail[0].reason, /^fresh_probe_retryable:http_503$/);
});

test("fresh-deploy DETERMINISTIC deep-link failure stays a terminal 500", async () => {
  const { deps } = makeDeps({ deepLinkClean: false, deepLinkReason: "http_404" });
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 500, "a real 404 is a bad build and must not be retried forever");
  assert.equal(res.body.error, "deployed_verification_failed");
});

test("critical visual proof blocks the alias when Chromium cannot measure it", async () => {
  const { deps, calls } = makeDeps({ renderStatus: "unavailable" });
  const res = await mirror(obrienRequest({
    brand: {
      mark: chooseBrandMark({
        logoCandidates: [],
        businessName: "O'Brien & Sons Roofing",
        accent: "#c8102e",
      }),
      site_accent: "#c8102e",
      site_accent_source: "https://obrien-roofing.example.com/",
    },
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  const order = calls.map(([name]) => name);
  assert.ok(order.indexOf("renderCheck") > order.indexOf("deepLinkCheck"));
  assert.ok(!order.includes("attachAlias"));
  assert.ok(!order.includes("aliasTargetCheck"));
  assert.equal(res.body.checks.render.status, "unavailable");
  assert.equal(res.body.checks.critical_visual.status, "failed");
  assert.equal(res.body.revealable, false);
});

test("sameness collision never publishes the legacy alias", async () => {
  const probe = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
  assert.equal(probe.status, 200);

  const { deps, calls } = makeDeps();
  deps.fleetIdentities = async () => [{
    slug: "existing-colliding-mirror",
    h1: probe.body.checks.sameness.headline,
    title: probe.body.checks.sameness.served_title,
  }];

  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.sameness.status, "failed");
  assert.equal(res.body.checks.alias_target.status, "staged");
  assert.equal(res.body.checks.editable.reason, "legacy_release_not_active");
  assert.equal(res.body.preview_url, "");
  assert.equal(res.body.revealable, false);
  assert.ok(!calls.some(([name]) => name === "attachAlias"), "failed attempt must never overwrite the public alias");
  assert.ok(!calls.some(([name]) => name === "aliasTargetCheck"), "an unpublished attempt has no alias target to certify");
});

test("an unrecorded generic wordmark stays unbranded and is never revealable", async () => {
  const { deps } = makeDeps();
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.brand.status, "unbranded");
  assert.equal(res.body.checks.brand.logo, "wordmark-fallback");
  assert.equal(res.body.checks.brand.accent, "donor-default");
  // No shipped hex, so nothing for the truth field or the default-palette
  // sniff to describe — both honestly null, never a guessed colour.
  assert.equal(res.body.checks.brand.accent_hex, null);
  assert.equal(res.body.checks.brand.default_suspect, null);
  assert.equal(res.body.revealable, false, "only an explicit ladder mark may downgrade the logo gate");
});

test("zero-logo ladder mark reveals with a wordmark rung and brand_mark_fallback polish flag", async () => {
  const { deps } = makeDeps();
  const mark = chooseBrandMark({
    logoCandidates: [],
    businessName: "O'Brien & Sons Roofing",
    accent: "#c8102e",
  });
  const res = await mirror(
    obrienRequest({
      brand: {
        mark,
        site_accent: "#c8102e",
        site_accent_source: "https://obrien-roofing.example.com/",
      },
    }),
    { registry: createRegistry(), deps },
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.checks.brand.status, "passed");
  assert.equal(res.body.checks.brand.logo, "wordmark-fallback");
  assert.equal(res.body.checks.brand.mark.rung, "wordmark");
  assert.equal(res.body.checks.brand.mark.value.text, "O'Brien & Sons Roofing");
  assert.equal(res.body.checks.brand.accent_hex, "#C8102E", "site CSS palette still flows without a logo");
  assert.match(res.body.checks.brand.accent_origin, /^site_chrome/);
  assert.equal(res.body.revealable, true);
  assert.deepEqual(
    res.body.polish_flags.find((flag) => flag.name === "brand_mark_fallback"),
    { name: "brand_mark_fallback", status: "fallback", cause: "wordmark" },
  );
});

test("brand marks reject cross-rung fields and normalize to the exact frozen shape", async () => {
  const mark = chooseBrandMark({
    logoCandidates: [],
    businessName: "O'Brien & Sons Roofing",
    accent: "#c8102e",
  });
  for (const extra of [
    { initials: "OS" },
    { arbitrary_tracking_field: "must-not-pass" },
  ]) {
    const checked = checkMirrorRequest(obrienRequest({
      brand: { mark: { ...mark, value: { ...mark.value, ...extra } } },
    }));
    assert.equal(checked.ok, false);
    assert.ok(checked.body.detail.some((item) => item.keyword === "additionalProperties"));
  }

  const normalized = await resolveBrandAssets({
    mark: {
      ...mark,
      ignored_top_level: true,
      value: { ...mark.value, initials: "OS", ignored_nested: true },
    },
  });
  assert.deepEqual(normalized.mark, mark, "the resolver passes only fields defined for the selected rung");
  assert.match(normalized.hashes.mark_sha, /^[0-9a-f]{64}$/);
});

test("changing the normalized fallback mark changes build_hash", async () => {
  const red = chooseBrandMark({
    logoCandidates: [],
    businessName: "O'Brien & Sons Roofing",
    accent: "#c8102e",
  });
  const blue = chooseBrandMark({
    logoCandidates: [],
    businessName: "O'Brien & Sons Roofing",
    accent: "#005dac",
  });
  const first = await mirror(obrienRequest({ brand: { mark: red } }), { dryRun: true, registry: createRegistry() });
  const same = await mirror(obrienRequest({ brand: { mark: red } }), { dryRun: true, registry: createRegistry() });
  const changed = await mirror(obrienRequest({ brand: { mark: blue } }), { dryRun: true, registry: createRegistry() });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(same.body.build_hash, first.body.build_hash);
  assert.notEqual(changed.body.build_hash, first.body.build_hash);
});

test("a ladder mark cannot launder a provenance-failing logo candidate", async () => {
  const mark = chooseBrandMark({
    logoCandidates: [],
    businessName: "O'Brien & Sons Roofing",
    accent: "",
  });
  const res = await mirror(
    obrienRequest({
      brand: {
        logo: "https://obrien-roofing.example.com/assets/blogger_logo.png",
        mark,
      },
    }),
    { dryRun: true, registry: createRegistry() },
  );

  assert.equal(res.status, 422);
  assert.equal(res.body.error, "brand_asset_rejected");
  assert.ok(res.body.detail.some((item) => item.reason === "third_party_mark_denylisted"));
});

// The sha256 here is the REAL hash of the bytes above. It used to be "a"*64 —
// a fixture that lied about its own content hash — which the brand-in-DOM check
// now catches, because that check re-hashes the bytes actually served.
const BRANDED_LOGO_BYTES = Buffer.from("\x89PNG\r\n\x1a\nfake-client-logo");
const BRANDED_LOGO_SHA = "d81b436cdf2ac7cbfc2bab5dcf4e7593f9a737fd07c545963a1795923d6b308e";
const BRANDED_STUB = async () => ({
  ok: true,
  logo: { bytes: BRANDED_LOGO_BYTES, sha256: BRANDED_LOGO_SHA, ext: "png", mime: "image/png", sourceUrl: "https://obrien-roofing.example.com/logo.png" },
  accent: "#c8102e",
  hashes: { logo_sha: BRANDED_LOGO_SHA },
});

test("full green BRANDED path: their logo + their accent -> revealable true, evidence tamper-evident", async () => {
  const { deps, files } = makeDeps();
  deps.resolveBrandAssets = BRANDED_STUB;
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  const m = res.body;
  assert.equal(m.checks.brand.status, "passed");
  assert.equal(m.checks.brand.logo, "client");
  assert.equal(m.checks.brand.accent, "measured");
  // THE SHIPPED HEX ITSELF, not just the "measured" label — this is what
  // release_evidence carries onto the row so the email side can wear the same
  // colour the site shipped in (prospects.brandTruthFromEvidence reads it).
  assert.equal(m.checks.brand.accent_hex, "#c8102e");
  // The default-palette sniff is REPORTED beside it and NEVER gates:
  // revealable is asserted true below with this field present, and its verdict
  // is pinned to the detector's own answer so the two cannot drift.
  const { checkAccent } = require("../lib/brand-default-detector.cjs");
  assert.deepEqual(m.checks.brand.default_suspect, checkAccent("#c8102e"));
  assert.ok(["ok", "suspicious", "framework_default"].includes(m.checks.brand.default_suspect.verdict));
  assert.ok(m.checks.brand.logo_slots_in_donor >= 1, "donor must expose {{LOGO_URL}} slots");
  assert.equal(m.revealable, true);
  assert.equal(m.logo_sha, BRANDED_LOGO_SHA);
  // Brand-in-DOM evidence: the served markup must POINT at the logo, and the
  // bytes behind that path must be the client's. "We wrote the file" is not
  // evidence — that is exactly how two companies shipped the same donor mark.
  assert.ok(m.checks.brand.logo_refs_in_output >= 1, "served markup must reference the client logo");
  assert.equal(m.checks.brand.logo_in_dom, true);
  assert.equal(m.checks.brand.logo_path, "/assets/client-logo.png");
  assert.equal(m.checks.brand.logo_sha_in_output, BRANDED_LOGO_SHA);
  assert.equal(m.checks.brand.logo_sha_in_output, m.checks.brand.logo_sha_source);
  const out = files();
  assert.ok(out["assets/client-logo.png"], "client logo bytes shipped");
  assert.ok(out["index.html"].toString("utf8").includes("/assets/client-logo.png"), "LOGO_URL points at the client logo");
  assert.ok(out["assets/style-def456.css"].toString("utf8").includes("--accent: 350"), "accent rewritten to the client hue");
  assert.equal(m.preview_url, "https://wss-test-obrien-and-sons-roofing.wss-ai.com/");
  assert.equal(m.renderer, "mirror-engine@v1");
  assert.notEqual(m.renderer, forge.FORGE_MIRROR_RENDERER, "cannot be confused with Forge");
  assert.notEqual(m.evidence_schema, forge.FORGE_RELEASE_EVIDENCE_SCHEMA, "cannot be confused with Forge evidence");
  assert.equal(signEvidence(m), m.evidence_sha);
  assert.notEqual(signEvidence({ ...m, renderer: "siteforge@v5" }), m.evidence_sha);
});

// ---------------------------------------------------------------------------
// BRAND-IN-DOM. The regression these tests exist for: two different companies
// shipped wearing the SAME donor mark while checks.brand said "passed", because
// the gate only asked whether a logo had been fetched and written. A file on
// disk that serves 200 is not a logo the visitor sees.
// ---------------------------------------------------------------------------
test("a donor that hardcodes its own mark FAILS the brand gate instead of false-passing", async () => {
  const { deps } = makeDeps();
  deps.resolveBrandAssets = BRANDED_STUB;
  const res = await mirror(
    obrienRequest({ donor: "mirror-donor-hardcoded-mark" }),
    { registry: createRegistry(), deps },
  );
  assert.equal(res.status, 500, "a mirror wearing someone else's mark must not deploy");
  assert.equal(res.body.error, "brand_logo_unreferenced");
  assert.equal(res.body.detail[0].reason, "client_logo_written_but_never_referenced_in_served_markup");
  assert.equal(res.body.detail[0].refs_in_output, 0);
  assert.equal(res.body.detail[0].logo_slots_in_donor, 0, "the donor exposes no slot to hydrate");
});

test("brand gate cannot pass on a written-but-unreferenced logo (dry_run path too)", async () => {
  const res = await mirror(
    obrienRequest({ donor: "mirror-donor-hardcoded-mark" }),
    { dryRun: true, registry: createRegistry(), deps: { resolveBrandAssets: BRANDED_STUB } },
  );
  // dry_run reaches the same measurement; the build is refused before any
  // Vercel call, so the false pass cannot even be reported as a manifest.
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "brand_logo_unreferenced");
});

test("MIRROR_REQUIRE_BRAND=1 refuses true brand absence but accepts a recorded ladder mark", async () => {
  process.env.MIRROR_REQUIRE_BRAND = "1";
  try {
    const res = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, "brand_required");

    const mark = chooseBrandMark({
      logoCandidates: [],
      businessName: "O'Brien & Sons Roofing",
      accent: "",
    });
    const accepted = await mirror(
      obrienRequest({ brand: { mark } }),
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.checks.brand.status, "passed");
  } finally {
    delete process.env.MIRROR_REQUIRE_BRAND;
  }
});

test("render failure keeps revealable false with named evidence", async () => {
  const { deps } = makeDeps({ renderStatus: "failed" });
  const res = await mirror(obrienRequest(), { registry: createRegistry(), deps });
  assert.equal(res.status, 200);
  assert.equal(res.body.checks.render.status, "failed");
  assert.equal(res.body.revealable, false);
});

// ---------------------------------------------------------------------------
// Slug policy
// ---------------------------------------------------------------------------
test("test namespace gate: real slugs blocked from deploy until owner flips the flag", async () => {
  const { deps } = makeDeps();
  const res = await mirror(obrienRequest({ slug: "obrien-and-sons-roofing" }), { registry: createRegistry(), deps });
  assert.equal(res.status, 422);
  assert.ok(res.body.detail.some((d) => d.reason === "test_namespace_only"));
  // dry_run is allowed on real slugs (no deploy happens).
  const dry = await mirror(obrienRequest({ slug: "obrien-and-sons-roofing" }), { dryRun: true, registry: createRegistry() });
  assert.equal(dry.status, 200);
});

test("reserved slugs: _acme-challenge fails the schema; infra labels fail policy", async () => {
  const schemaRejected = await mirror(obrienRequest({ slug: "_acme-challenge" }), { dryRun: true, registry: createRegistry() });
  assert.equal(schemaRejected.status, 400);
  const reserved = await mirror(obrienRequest({ slug: "mail" }), { dryRun: true, registry: createRegistry() });
  assert.equal(reserved.status, 422);
  assert.ok(reserved.body.detail.some((d) => d.reason === "reserved_slug"));
  assert.equal(slugPolicy("_acme-challenge").ok, false);
});

// ---------------------------------------------------------------------------
// Token contract single-source
// ---------------------------------------------------------------------------
test("one token set: OWNER_NAME included; docs generate from the same defs", () => {
  assert.ok(ALLOWED_TOKENS.has("OWNER_NAME"));
  assert.equal(TOKEN_DEFS.OWNER_NAME.required, false);
  const docs = generatedDocs();
  for (const t of ALLOWED_TOKENS) assert.ok(docs.includes(`{{${t}}}`), `docs missing ${t}`);
});

test("brand accent without measurement source is rejected up front", async () => {
  const res = await mirror(
    { ...obrienRequest(), brand: { accent: "#fd7e00", accent_source: "https://obrien-roofing.example.com/logo.png" } },
    { dryRun: true, registry: createRegistry() },
  );
  // accent_source passes the denylist; accent applies. (No logo fetch: none given.)
  assert.equal(res.status, 200);
  const denied = await mirror(
    { ...obrienRequest(), brand: { accent: "#15a3fa", accent_source: "https://cdn.example.com/1024px-Facebook_f_logo_2021.png" } },
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(denied.status, 422);
  assert.equal(denied.body.error, "brand_asset_rejected");
});

test("facts boundary: validateFacts never mutates the caller's object", () => {
  const req = obrienRequest();
  const frozen = JSON.stringify(req);
  validateFacts(req);
  assert.equal(JSON.stringify(req), frozen);
});
