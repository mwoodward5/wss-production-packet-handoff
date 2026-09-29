"use strict";

// test/preview-legal-hygiene.test.js
//
// LEGAL HYGIENE OF A CONCEPT SITE (owner-endorsed, 2026-08): every site the
// mirror engine ships is a CONCEPT until the client says otherwise, so every
// page carries (1) `noindex, nofollow` in the robots meta and (2) a small
// visible "Unofficial concept by WSS Labs" line. These tests hold the contract:
//
//   1. The built head carries the noindex meta — appended when absent,
//      REPLACED when a page already declares index-class directives, preserved
//      when the full directive is already there (idempotent).
//   2. The attribution footer renders exactly once per page, anchored before
//      </body>, classed `wss-attr` so RELOCATE_JS never mistakes it for the
//      donor's real footer.
//   3. Donor layout safety: the footer is a self-contained sibling block, and
//      pages without a </body> anchor get the meta but no footer.
//   4. ENGINE level: a real dryRun build on the plumbing donor ships both
//      signals on every HTML page of the bundle, including the generated 404.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  applyLegalHygiene,
  buildAttributionFooter,
  inject,
  noindexHtml,
  notFoundPage,
} = require("../lib/mirror-engine/content-inject");

const ROBOTS_RE = /<meta[^>]*\bname=["']robots["'][^>]*>/gi;
const robotsMetas = (html) => html.match(ROBOTS_RE) || [];

// ---------------------------------------------------------------------------
// 1. The noindex meta, per page.
// ---------------------------------------------------------------------------

test("noindexHtml appends the meta when the head has none", () => {
  const html = "<!doctype html><html><head><title>T</title></head><body></body></html>";
  const out = noindexHtml(html);
  assert.match(out, /<meta name="robots" content="noindex, nofollow" \/>\s*<\/head>/i);
  assert.equal(robotsMetas(out).length, 1);
});

test("noindexHtml replaces index-class directives and keeps the rest", () => {
  const html = '<html><head><meta name="robots" content="index,follow" /></head></html>';
  assert.match(noindexHtml(html), /content="noindex, nofollow"/i);
  // A directive that is not about indexing survives the pass.
  const html2 = '<html><head><meta name="robots" content="noarchive, index" /></head></html>';
  assert.match(noindexHtml(html2), /content="noarchive, noindex, nofollow"/i);
});

test("noindexHtml upgrades a bare noindex (the 404) to the full directive", () => {
  const html = '<html><head><meta name="robots" content="noindex"/></head></html>';
  assert.match(noindexHtml(html), /content="noindex, nofollow"/i);
});

test("noindexHtml is idempotent: a compliant page is returned byte-identical", () => {
  const html = '<html><head><meta name="robots" content="noindex, nofollow" /></head><body></body></html>';
  assert.equal(noindexHtml(html), html);
  // And running the pass twice never stacks a second meta.
  const once = noindexHtml("<html><head></head><body></body></html>");
  const twice = noindexHtml(once);
  assert.equal(twice, once);
  assert.equal(robotsMetas(twice).length, 1);
});

test("noindexHtml on a page with no </head> is a no-op, not a corruption", () => {
  const html = "<p>fragment</p>";
  assert.equal(noindexHtml(html), html);
});

// ---------------------------------------------------------------------------
// 2. The attribution footer.
// ---------------------------------------------------------------------------

test("the footer names the public brand and answers to a real inbox", () => {
  const footer = buildAttributionFooter({ supportEmail: "support@woodwardsoftware.com" });
  assert.match(footer, />Unofficial concept by <a href="mailto:support@woodwardsoftware\.com">WSS Labs<\/a><\/footer>/);
  // Banned public copy never ships (lib/copy-ban.js).
  assert.doesNotMatch(footer, /ghost agency/i);
});

test("the footer carries the wss-attr class RELOCATE_JS must skip", () => {
  // relocateJs's footer() ignores any footer whose className starts with
  // "wss-", so the relocation logic can never treat OUR line as the donor's
  // real footer and give up placement.
  const footer = buildAttributionFooter({});
  assert.match(footer, /<footer class="wss-attr" data-wss-attribution="v1">/);
  assert.match(footer, /footer\.wss-attr\{/);
});

// ---------------------------------------------------------------------------
// 3. applyLegalHygiene over a file map.
// ---------------------------------------------------------------------------

function pageOf(title) {
  return Buffer.from(
    `<!doctype html><html><head><title>${title}</title></head><body><p>${title}</p></body></html>`,
    "utf8",
  );
}

test("every HTML page gets the meta and exactly one footer; non-HTML is untouched", () => {
  const files = {
    "index.html": pageOf("Home"),
    "about.html": pageOf("About"),
    "404.html": notFoundPage({ facts: { business_name: "Anchor Plumbing" } }),
    "assets/bundle.js": Buffer.from("console.log(1);", "utf8"),
    "robots.txt": Buffer.from("User-agent: *\nAllow: /\n", "utf8"),
  };
  const { files: out, report } = applyLegalHygiene({ files });
  for (const rel of ["index.html", "about.html", "404.html"]) {
    const html = out[rel].toString("utf8");
    assert.equal(robotsMetas(html).length, 1, `${rel}: exactly one robots meta`);
    assert.match(html, /name="robots" content="noindex, nofollow"/i, `${rel}: noindex`);
    assert.equal((html.match(/data-wss-attribution="v1"/g) || []).length, 1, `${rel}: footer once`);
    assert.match(html, /<\/footer>\s*<\/body>/i, `${rel}: footer anchored before </body>`);
  }
  assert.equal(report.noindex_pages, 3);
  assert.equal(report.attribution_pages, 3);
  // The 404's bare noindex was upgraded, not duplicated.
  assert.match(out["404.html"].toString("utf8"), /content="noindex, nofollow"/i);
  // Inputs are never mutated.
  assert.doesNotMatch(files["index.html"].toString("utf8"), /noindex/);
});

test("the pass is idempotent over a whole bundle", () => {
  const files = { "index.html": pageOf("Home") };
  const once = applyLegalHygiene({ files });
  const twice = applyLegalHygiene({ files: once.files });
  assert.equal(twice.report.pages, 0);
  assert.equal(twice.report.noindex_pages, 0);
  assert.equal(twice.report.attribution_pages, 0);
  assert.equal(
    once.files["index.html"].toString("utf8"),
    twice.files["index.html"].toString("utf8"),
  );
});

test("a page with no </body> anchor gets the meta but no footer, and says so", () => {
  const files = { "odd.html": Buffer.from("<html><head></head><p>no body close</p></html>", "utf8") };
  const { files: out, report } = applyLegalHygiene({ files });
  const html = out["odd.html"].toString("utf8");
  assert.match(html, /name="robots" content="noindex, nofollow"/i);
  assert.doesNotMatch(html, /data-wss-attribution/);
  assert.equal(report.attribution_pages, 0);
  assert.equal(report.noindex_pages, 1);
});

// ---------------------------------------------------------------------------
// 4. Built output: the content injector's own pages, then a real engine build.
// ---------------------------------------------------------------------------

test("inject() built output carries the signals once the engine pass runs", () => {
  const built = inject({
    files: { "index.html": pageOf("Donor") },
    content: { services: [{ name: "Drain Cleaning" }] },
    facts: { business_name: "Anchor Plumbing Co", industry: "plumbing", city: "Wasilla", state: "AK" },
    phoneDigits: "9075550123",
    slug: "wss-test-anchor-plumbing",
  });
  const hydrated = applyLegalHygiene({ files: built.files });
  const html = hydrated.files["index.html"].toString("utf8");
  assert.equal(robotsMetas(html).length, 1);
  assert.match(html, /content="noindex, nofollow"/i);
  assert.equal((html.match(/data-wss-attribution="v1"/g) || []).length, 1);
});

test("ENGINE: a dryRun build on the real plumbing donor applies both signals to every page", async () => {
  const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
  process.env.MIRROR_DONOR_ROOT = DONOR_ROOT;
  process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-legal-"));
  const { mirror } = require("../lib/mirror-engine/engine");
  const { createRegistry } = require("../lib/mirror-engine/build-hash");
  const res = await mirror(
    {
      slug: "wss-test-legal-hygiene-anchor",
      donor: "plumbing-clean",
      facts: {
        business_name: "Anchor Plumbing",
        industry: "plumbing",
        city: "Dyersville",
        state: "IA",
        phone: "(563) 555-0142",
        latitude: 42.484412,
        longitude: -91.123208,
      },
      content: { areas: ["Dyersville"], services: ["Drain cleaning"], reviews: [], faqs: [] },
    },
    { dryRun: true, registry: createRegistry() },
  );
  assert.equal(res.ok, true, JSON.stringify(res.body).slice(0, 600));
  // The dry-run manifest does not carry bytes, but checks.content spreads the
  // engine's content report — where the hygiene pass accounts for itself off
  // the files it actually touched (same law as signup_panel / call_bar).
  const hygiene = res.body.checks.content.legal_hygiene;
  assert.ok(hygiene, "engine reports the legal-hygiene pass");
  assert.ok(hygiene.noindex_pages >= 1, `every HTML page was noindexed (${hygiene.noindex_pages})`);
  assert.equal(hygiene.attribution_pages, hygiene.noindex_pages, "every HTML page carries the footer");
}, { timeout: 120000 });
