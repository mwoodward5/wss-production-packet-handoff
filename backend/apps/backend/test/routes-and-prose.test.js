"use strict";

// test/routes-and-prose.test.js — the two defects that shipped to real
// prospects with every gate green:
//
//   1. ROUTE COLLISIONS / SOFT 404s. deploy.js fell back to a blanket
//      `{"source":"/(.*)","destination":"/"}` whenever the donor declared no
//      spa_routes — and none of the three usable donors declares any. Every
//      path answered 200; eight footer service links and /services resolved to
//      the identical rewrite.
//
//   2. PLACEHOLDER LEAKAGE. An optional token that is correctly blank left a
//      hole inside a sentence: "Ask for  · Sterling, VA" and
//      "Call AllTech Services, Inc and ask for  to start the conversation."
//
// Every assertion below is on real donor bytes, not a fixture invented to pass.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const DONOR_ROOT = path.join(__dirname, "..", "boilerplates");
process.env.MIRROR_DONOR_ROOT = DONOR_ROOT;

const { hydrate } = require("../lib/mirror-engine/hydrate");
const { loadDonor } = require("../lib/mirror-engine/donor");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");
const { spaVercelJson } = require("../lib/mirror-engine/deploy");
const routes = require("../lib/mirror-engine/routes");
const prose = require("../lib/mirror-engine/prose");
const { htmlToVisibleText } = require("../lib/mirror-engine/visible-text");

const USABLE = ["roofing-riseabove", "plumbing-pressure-lens", "tree-care-dark"];

/** Token map with every REQUIRED value present and every optional one blank —
 *  the adversarial-by-omission fixture the whole engine is designed around. */
function blankOptionals(extra = {}) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  return Object.assign(tv, {
    BUSINESS_NAME: "AllTech Services, Inc",
    PHONE: "(703) 555-0155",
    PHONE_DIGITS: "7035550155",
    CITY: "Sterling",
    ADDRESS_CITY: "Sterling",
    STATE: "VA",
    REGION: "VA",
    HERO_HEADLINE: "Plumbing in Sterling, VA",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "wss-test-x.wss-ai.com",
    PREVIEW_DOMAIN: "wss-test-x.wss-ai.com",
    PREVIEW_URL: "https://wss-test-x.wss-ai.com/",
    SITE_URL: "https://wss-test-x.wss-ai.com/",
  }, extra);
}

const manifestOf = (name) => JSON.parse(fs.readFileSync(path.join(DONOR_ROOT, name, "BOILERPLATE.json"), "utf8"));

// ---------------------------------------------------------------------------
// Placeholder leakage
// ---------------------------------------------------------------------------
test("the exact sentences that shipped broken now collapse whole", () => {
  const donor = loadDonor(path.join(DONOR_ROOT, "plumbing-pressure-lens"));
  const out = hydrate({ donorFiles: donor.files, tokenValues: blankOptionals() });
  assert.equal(out.ok, true, JSON.stringify(out.detail));
  const text = htmlToVisibleText(out.files["index.html"].toString("utf8"));

  assert.ok(!text.includes("Ask for ·"), "hero note still renders a separator with no owner");
  assert.ok(!/ask for\s+to start/i.test(text), "contact copy still renders 'ask for to start'");
  assert.ok(text.includes("Call AllTech Services, Inc to start the conversation."),
    "the sentence must read as English with the owner phrase gone");
});

test("the same sentences keep the owner when the owner is verified", () => {
  const donor = loadDonor(path.join(DONOR_ROOT, "plumbing-pressure-lens"));
  const out = hydrate({ donorFiles: donor.files, tokenValues: blankOptionals({ OWNER_NAME: "Dana Reyes" }) });
  assert.equal(out.ok, true);
  const text = htmlToVisibleText(out.files["index.html"].toString("utf8"));
  assert.ok(text.includes("Ask for Dana Reyes · Sterling, VA"));
  assert.ok(text.includes("and ask for Dana Reyes to start the conversation."));
});

for (const donorName of USABLE) {
  test(`${donorName}: no optional token is welded into literal copy (blank AND full)`, () => {
    const donor = loadDonor(path.join(DONOR_ROOT, donorName));
    const full = blankOptionals({
      OWNER_NAME: "Dana Reyes", COUNTY: "Loudoun County", POSTAL: "20166",
      EMAIL: "hello@example.com", LICENSE: "VA 2705-11", PROFILE_URL: "https://example.com/p",
      RATING: "4.9", REVIEW_COUNT: "31", ADDRESS: "1 Main St",
      GEO_LAT: "39.0", GEO_LNG: "-77.4", GEO: "39.0,-77.4",
      HERO_ACCENT: "Accent", HERO_BADGE: "Badge",
    });
    for (const [label, tv] of [["blank", blankOptionals()], ["full", full]]) {
      const out = hydrate({ donorFiles: donor.files, tokenValues: tv });
      assert.equal(out.ok, true, `${donorName} ${label}: ${out.error} ${JSON.stringify(out.detail)}`);
      for (const [rel, buf] of Object.entries(out.files)) {
        if (!/\.(html|js|css|json|svg|xml|txt|webmanifest)$/i.test(rel)) continue;
        assert.ok(!prose.PHRASE_RESIDUE_RE.test(buf.toString("utf8")), `${rel} still carries a phrase marker`);
      }
    }
  });
}

test("an unguarded optional slot fails the build closed", () => {
  const donorFiles = {
    "index.html": Buffer.from("<!doctype html><html><body><p>Call us and ask for {{OWNER_NAME}} today.</p></body></html>"),
  };
  const out = hydrate({ donorFiles, tokenValues: blankOptionals() });
  assert.equal(out.ok, false);
  assert.equal(out.error, "unguarded_optional_slot");
  assert.equal(out.detail[0].token, "OWNER_NAME");
});

test("a phrase marker left unresolved can never ship", () => {
  assert.ok(prose.PHRASE_RESIDUE_RE.test("Call [[NEED:OWNER_NAME]]x[[/NEED]]"));
  assert.throws(() => prose.collapsePhrases("[[NEED:OWNER_NAME]]dangling", () => true), /unclosed/);
  assert.throws(() => prose.collapsePhrases("dangling[[/NEED]]", () => true), /stray/);
});

test("the artifact scanner catches the real defects and spares real copy", () => {
  const broken = [
    "Ask for · Sterling, VA",
    "Call AllTech Services, Inc and ask for to start the conversation.",
    "  ·  Clarksville / ",
  ];
  for (const b of broken) assert.ok(prose.proseArtifacts(b).length > 0, `missed: ${b}`);
  const fine = [
    "Call to begin",
    "Ask to see the written scope.",
    "Services: roof repair, gutters, storm response",
    "Serving Sterling, VA and the surrounding area.",
    "Loudoun County · 20166",
  ];
  for (const f of fine) assert.deepEqual(prose.proseArtifacts(f), [], `false positive: ${f}`);
});

test("'look for in' is a phrasal verb, not a collapsed slot", () => {
  // MEASURED, not imagined. These two lines are the rendered innerText of FAQ
  // headings on wss-test-bruce-thornton-air-conditioning-lubbock (/ and /faq)
  // and wss-test-cooper-perry-plumbing-tulsa (/). Both mirrors built, deployed
  // and aliased cleanly, passed all thirteen other checks, and were then
  // refused as not revealable over these — the whole cost of the run for two
  // businesses, for ordinary English.
  const fine = [
    "What should I look for in a full-service HVAC provider in Texas?",
    "What Should I Look for in Plumbing Services?",
    "Know what to ask for at the first visit.",
    "What you pay for in a service call.",
  ];
  for (const f of fine) {
    assert.deepEqual(prose.proseArtifacts(f), [], `false positive: ${f}`);
  }

  // THE EXEMPTION MUST NOT SWALLOW THE DEFECT IT LOOKS LIKE.
  // "for to" is not legal English after any verb, so the phrasal-verb reading
  // never applies to it — this is the line the corpus actually broke on, with
  // the owner's name deleted out of the middle, and it stays caught.
  const stillBroken = [
    "Call AllTech Services, Inc and ask for to start the conversation.",
    "Ask for to begin.",
    "Look for and the rest of the team.",
    "Ask for or call the office.",
    "Shop for with confidence.",
    // no phrasal verb in front: a bare stacked preposition is still a hole
    "Serving for in the area.",
  ];
  for (const b of stillBroken) {
    assert.ok(prose.proseArtifacts(b).length > 0, `exemption swallowed a real defect: ${b}`);
  }
});

test("a state code is a proper noun, not a dangling connector", () => {
  // MEASURED, not imagined: these three lines are the rendered innerText of
  // wss-test-crown-plumbing-portland — a header chip, the hero locality, and a
  // stat tile whose whole value is the state. All six mirrors in the owner's
  // Portland run were refused on them, and on nothing else.
  const oregon = [
    "PORTLAND · OR",
    "PORTLAND, OR",
    "OR",
    "OREGON CITY · OR",
    "Portland, OR",
    "Serving all of IN",          // Indiana, read as "of in"
    "Indianapolis, IN",
    "Bar Harbor, ME",
  ];
  for (const line of oregon) {
    assert.deepEqual(prose.proseArtifacts(line), [], `state code refused as prose: ${line}`);
  }

  // The exemption must not become a hole. A lowercase conjunction is still a
  // conjunction however it is punctuated, and the other connectors never get
  // the exemption at all.
  const stillBroken = [
    "Repairs, replacements, or",   // a list that lost its last item
    "Portland, and",               // only two-letter STATE CODES are exempt
    "Serving Portland · with",
    "Estimates prepared by",
    "of in",                       // lowercase: not Indiana
  ];
  for (const line of stillBroken) {
    assert.ok(prose.proseArtifacts(line).length > 0, `state-code exemption swallowed a real defect: ${line}`);
  }

  // Shape matters too: a state code only earns the exemption standing alone or
  // after a locality separator. Welded to a sentence it is still a defect.
  assert.ok(
    prose.proseArtifacts("Call the team and ask OR").length > 0,
    "an uppercase OR mid-sentence is not a locality",
  );
});

test("a double space inside one text node is a collapsed value, not whitespace", () => {
  const hits = prose.collapsedValueGaps("<p>Call Acme and ask for  to start.</p>");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, "collapsed_value_gap");
  assert.deepEqual(prose.collapsedValueGaps("<p>\n  Indented markup is not a gap.\n</p>"), []);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
test("no route set means NO catch-all — an unknown path must reach a real 404", () => {
  const json = JSON.parse(spaVercelJson([]).toString("utf8"));
  assert.equal(json.cleanUrls, true);
  assert.deepEqual(json.rewrites, [], "a blanket /(.*) rewrite is what made every path answer 200");
});

test("a dynamic segment claims its children; a static route claims only itself", () => {
  const json = JSON.parse(spaVercelJson({ exact: ["/about", "/services"], prefixes: ["/services"] }).toString("utf8"));
  const sources = json.rewrites.map((r) => r.source);
  assert.ok(sources.includes("/services"));
  assert.ok(sources.includes("/services/(.*)"));
  assert.ok(sources.includes("/about"));
  assert.ok(!sources.includes("/about/(.*)"), "a static route must not swallow child paths");
  assert.ok(!sources.includes("/(.*)"));
  assert.ok(json.rewrites.every((r) => r.destination === "/"), "cleanUrls 308s /index.html; destination must be /");
});

const SERVICE_SLUGS = ["roof-replacement", "roof-repair", "storm-damage", "roof-inspections",
  "gutters", "siding-soffit-fascia", "decks-drywall-painting", "commercial-roofing"];

test("roofing-riseabove: the compiled router table is read, and no link is dead", () => {
  const donor = loadDonor(path.join(DONOR_ROOT, "roofing-riseabove"));
  const plan = routes.deriveRoutes({ files: donor.files, manifest: manifestOf("roofing-riseabove") });
  assert.equal(plan.source, "compiled_router");
  assert.ok(plan.prefixes.includes("/services"), "/$service must resolve to a /services prefix");
  assert.ok(plan.prefixes.includes("/insights"));
  assert.deepEqual(plan.dead, [], "every link the donor renders must resolve");
});

// PROVEN LIVE on wss-test-step3b-obrien-roofing: /services/gutters returned
// <title>Gutters</title> and the /services LIST body — text_hash identical
// across /services and six sub-paths. The compiled $service route resolves its
// head and renders its parent. So the donor links at the anchor that exists.
test("roofing-riseabove: every service link is an anchor on /services, not a colliding sub-path", () => {
  const html = fs.readFileSync(path.join(DONOR_ROOT, "roofing-riseabove", "index.html"), "utf8");
  for (const slug of SERVICE_SLUGS) {
    assert.ok(!html.includes(`href="/services/${slug}"`), `/services/${slug} renders the list page, not the service`);
    assert.ok(html.includes(`href="/services#${slug}"`), `no anchor link for ${slug}`);
  }
  const donor = loadDonor(path.join(DONOR_ROOT, "roofing-riseabove"));
  const plan = routes.deriveRoutes({ files: donor.files, manifest: manifestOf("roofing-riseabove") });
  const ids = plan.hashTargets.filter((h) => h.path === "/services").map((h) => h.id).sort();
  assert.deepEqual(ids, [...SERVICE_SLUGS].sort(), "all eight fragments must be tracked for the rendered id check");
});

test("a static donor declares no routes at all, so nothing is rewritten", () => {
  const donor = loadDonor(path.join(DONOR_ROOT, "plumbing-pressure-lens"));
  const plan = routes.deriveRoutes({ files: donor.files, manifest: manifestOf("plumbing-pressure-lens") });
  assert.deepEqual(plan.exact, []);
  assert.deepEqual(plan.prefixes, []);
  assert.deepEqual(plan.dead, []);
});

test("a link to nothing is removed, and its bullet goes with it", () => {
  const files = {
    "index.html": Buffer.from(
      '<!doctype html><html><body><ul><li><a href="/real">Real</a></li>'
      + '<li><a href="/ghost">Ghost</a></li></ul><a href="/ghost#x">inline</a></body></html>',
    ),
  };
  const { files: out, removed } = routes.pruneDeadLinks(files, ["/ghost"]);
  const html = out["index.html"].toString("utf8");
  assert.equal(removed, 2);
  assert.ok(!html.includes("/ghost"));
  assert.ok(!html.includes("Ghost"));
  assert.ok(html.includes('<a href="/real">Real</a>'));
  assert.ok(!/<li>\s*<\/li>/.test(html), "an empty bullet is a link to nothing with extra steps");
});

test("a #fragment whose id does not exist loses the fragment, not the link", () => {
  const files = { "index.html": Buffer.from('<a href="/services#gone">Go</a>') };
  const { files: out, stripped } = routes.stripHashes(files, [{ path: "/services", id: "gone" }]);
  assert.equal(stripped, 1);
  assert.equal(out["index.html"].toString("utf8"), '<a href="/services">Go</a>');
});

test("hrefs that are not site paths are never mistaken for routes", () => {
  for (const href of ["tel:7035550155", "mailto:a@b.com", "https://example.com/x", "#services", "//cdn.example.com/a"]) {
    assert.equal(routes.toSitePath(href), null, href);
  }
  assert.deepEqual(routes.toSitePath("/services#roof-repair"), { path: "/services", hash: "roof-repair" });
  assert.deepEqual(routes.toSitePath("/work/"), { path: "/work", hash: "" });
});

test("a fragment into a REAL shipped page is adjudicated from bytes; an SPA route is not", () => {
  const files = {
    "index.html": Buffer.from('<a href="/about#team">Team</a><a href="/services#gutters">Gutters</a>'),
    "about.html": Buffer.from('<html><body><h2 id="history">History</h2></body></html>'),
  };
  const targets = [{ path: "/about", id: "team" }, { path: "/about", id: "history" }, { path: "/services", id: "gutters" }];
  const missing = routes.staticMissingHashes(files, targets);
  assert.deepEqual(missing, [{ path: "/about", id: "team" }],
    "only the id genuinely absent from a shipped file may be stripped; /services renders its ids at runtime");
});

// ---------------------------------------------------------------------------
// A CUSTOMER'S REVIEW IS NOT OUR BROKEN COPY
// ---------------------------------------------------------------------------
// Mills Fence's mirror was refused on route_render with
//   rule = dangling_word:"with to…"
//   text = "Stephen and his crew were so awesome to work with and we couldn't
//           be happier with our backyard fence."
// "work with and" is ordinary English. verify.js already strips
// [data-wss-verbatim] before running the prose rules for exactly this reason —
// "a real customer wrote 'great to work with and totally took care of us' and
// failed a clean mirror" — but the fencing donor renders reviews ITSELF from
// the island array, so they never pass through content-inject, the only place
// that marks a review verbatim. The donor's own carousel now carries the
// attribute; the rule keeps full strength over copy we wrote.

test("the fencing donor marks its review text as third-party verbatim", () => {
  // Resolve the entry chunk by SHAPE, not by hash: every donor rebuild mints a
  // new index-<hash>.js, and a pinned filename turns this gate into an ENOENT
  // that nobody reads as "the verbatim marking is gone".
  const assets = path.join(__dirname, "..", "donors-clean", "fencing-sterling", "assets");
  const entry = fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
  assert.ok(entry, "the fencing donor must ship an entry bundle");
  const bundle = fs.readFileSync(path.join(assets, entry), "utf8");
  // The paragraph that prints l.text — the review body — and nothing else.
  assert.match(bundle, /"data-wss-verbatim":"third-party-review",className:"text-lg sm:text-xl text-foreground leading-relaxed italic mb-8"/);
});

test("the prose rule still catches the same word pair in copy we wrote", () => {
  // The exemption is markup-scoped, not rule-scoped. A genuine collapsed slot
  // in our own sentence must still fail.
  const { proseArtifacts } = require("../lib/mirror-engine/prose");
  const real = proseArtifacts("Call AllTech Services and ask for to start the conversation.");
  assert.ok(real.length, "a real hole must still be caught");
  const review = proseArtifacts("Stephen and his crew were so awesome to work with and we couldn't be happier with our backyard fence.");
  assert.ok(review.length, "the RULE still fires — it is the verbatim markup that exempts the block, not the rule");
});

test("a broken-prose refusal prints what the page said, not just the rule's label", () => {
  // An operator reading `dangling_word:"with to…"` cannot tell a real hole from
  // a customer review; the page never contained the words "with to". The
  // excerpt was already captured one function away and thrown out here.
  const { renderAudit } = require("../lib/mirror-engine/verify");
  assert.equal(typeof renderAudit, "function");
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "verify.js"), "utf8");
  assert.match(source, /broken_prose:\$\{prose\.map/);
  assert.match(source, /first\.excerpt/, "the excerpt must reach the problem string");
});
