"use strict";

// test/content-pipeline-audit-de.test.js
//
// Pins the two content-pipeline bugs from the 10-site Comet audit (issue 563):
//
//   BUG D — FAQ answer unfiltered dump (Canyon). The first FAQ answer shipped
//   as a wall of concatenated harvest fragments. Three render surfaces read
//   `content.faqs` WITHOUT cleanFaqAnswer — the data island a consumes_content
//   donor renders itself, llms.txt, and the /faq authority page — and the two
//   surfaces that DID clean capped at 500 chars, which is still a wall. The
//   cap now sits in the audit's 280–320 band, cuts at a sentence boundary
//   (never mid-word), and strips same-word-run fragments at the door every
//   surface shares (sanitizedFaqs).
//
//   BUG E — Masthead coordinate artifact (Nevada). A decorative masthead node
//   printed raw data — a coordinate pair / hex color / placeholder token — as
//   if it were copy. The fleet CSS floor hides `.coordinates`-class nodes, but
//   the live artifact carried no such marker, so the render pass suppresses
//   the pattern itself: a LEAF decor-named node whose entire text is
//   data-shaped junk is emptied and hidden; real heading copy survives.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildContentHtml,
  buildJsonLd,
  cleanFaqAnswer,
  inject,
  sanitizedFaqs,
  stripMastheadDecorArtifacts,
} = require("../lib/mirror-engine/content-inject");
const authorityPages = require("../lib/mirror-engine/authority-pages");

const facts = {
  business_name: "Canyon Plumbing Co",
  industry: "plumbing",
  city: "St. George",
  state: "UT",
};

// A Canyon-shaped dump: the same harvest fragment concatenated well past any
// readable length (900+ chars), like the live first FAQ the audit flagged.
const CANYON_WALL = "Emergency plumbing service for St. George homes. ".repeat(22);
assert.ok(CANYON_WALL.length >= 900, "fixture must model the live wall");

const graphNodes = (graph, type) => graph["@graph"].filter((node) => {
  const kinds = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return kinds.includes(type);
});

// ---- BUG D: the cleaner itself -------------------------------------------

test("cleanFaqAnswer caps a fragment wall inside the audit band at a sentence boundary", () => {
  const answer = cleanFaqAnswer(CANYON_WALL);
  assert.ok(answer.length <= 300, `capped answer must respect the hard cap, got ${answer.length}`);
  assert.ok(answer.length >= 200, "the cap cuts at a sentence boundary, not at the first line");
  assert.match(answer, /\.$/, "the cap lands on a sentence end, never mid-word");
  assert.ok(answer.includes("Emergency plumbing service for St. George homes."));
  assert.ok(!CANYON_WALL.includes(answer.slice(-30) + "x"), "no manufactured tail");
});

test("cleanFaqAnswer strips concatenated same-word-run fragments", () => {
  assert.equal(
    cleanFaqAnswer("Our plumbing team handles drain drain drain cleaning without damaging your pipes."),
    "Our plumbing team handles drain cleaning without damaging your pipes.",
  );
  const answer = cleanFaqAnswer(`Water heaters serviced daily. ${"leaks leaks leaks water damage repairs. ".repeat(30)}`);
  assert.ok(!/\b(\w+)\s+\1\s+\1\b/i.test(answer), "no 3x same-word run survives the cleaner");
  assert.ok(answer.length <= 300);
});

test("cleanFaqAnswer with no sentence boundary still never cuts a word in half", () => {
  const answer = cleanFaqAnswer("alpha beta ".repeat(180));
  assert.ok(answer.length <= 300);
  assert.ok(answer.split(" ").every((w) => w === "alpha" || w === "beta"), "cut lands on a word edge");
});

test("cleanFaqAnswer leaves a short honest answer untouched", () => {
  assert.equal(cleanFaqAnswer("Family owned since 1998."), "Family owned since 1998.");
});

test("sanitizedFaqs is the one door: capped answers, junk entries dropped, extra fields kept", () => {
  const cleaned = sanitizedFaqs([
    { q: "Wall?", a: CANYON_WALL, source: "client-site" },
    { q: "No answer?", a: "   " },
    "not-an-object",
  ]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].source, "client-site");
  assert.ok(cleaned[0].a.length <= 300);
});

// ---- BUG D: every rendered surface ---------------------------------------

test("the injected FAQ block renders the capped answer, not the wall", () => {
  const html = buildContentHtml({
    content: { services: [{ name: "Drain Cleaning" }], faqs: [{ q: "Do you serve St. George?", a: CANYON_WALL }] },
    facts,
  });
  assert.match(html, /<details id="faq-1"/);
  assert.ok(!html.includes(CANYON_WALL), "the full wall must not reach the rendered page");
  assert.match(html, /Emergency plumbing service for St\. George homes\.<\/p>/, "the capped sentence does");
});

test("the JSON-LD FAQPage answer is capped the same way", () => {
  const graph = buildJsonLd({
    content: { services: [{ name: "Drain Cleaning" }], faqs: [{ q: "Do you serve St. George?", a: CANYON_WALL }] },
    facts,
    siteUrl: "https://canyon.wss-ai.com/",
  });
  const faq = graphNodes(graph, "FAQPage")[0];
  const text = faq.mainEntity[0].acceptedAnswer.text;
  assert.ok(text.length <= 300, `schema answer capped, got ${text.length}`);
  assert.ok(!text.includes(CANYON_WALL));
});

test("the data island a consumes_content donor renders itself carries capped answers", () => {
  const out = inject({
    files: { "index.html": Buffer.from("<!doctype html><html><head></head><body></body></html>") },
    content: { services: [{ name: "Drain Cleaning" }], faqs: [{ q: "Wall?", a: CANYON_WALL }] },
    facts,
    slug: "canyon-plumbing",
  });
  const island = /<script id="wss-content" type="application\/json">(.*?)<\/script>/s.exec(
    out.files["index.html"].toString("utf8"),
  );
  assert.ok(island, "island present");
  const payload = JSON.parse(island[1]);
  assert.equal(payload.faqs.length, 1);
  assert.ok(payload.faqs[0].a.length <= 300, `island answer capped, got ${payload.faqs[0].a.length}`);
});

test("llms.txt quotes the capped answer", () => {
  const out = inject({
    files: { "index.html": Buffer.from("<!doctype html><html><head></head><body></body></html>") },
    content: { services: [{ name: "Drain Cleaning" }], faqs: [{ q: "Wall?", a: CANYON_WALL }] },
    facts,
    slug: "canyon-plumbing",
  });
  const llms = out.files["llms.txt"].toString("utf8");
  assert.ok(!llms.includes(CANYON_WALL), "the full wall must not reach the AI surface");
  assert.match(llms, /### Wall\?\nEmergency plumbing service for St\. George homes\./);
});

test("the /faq authority page and its FAQPage schema use the capped answer", () => {
  const out = authorityPages.build({
    facts,
    phoneDigits: "4355550123",
    slug: "canyon-plumbing",
    content: { services: [{ name: "Drain Cleaning" }], faqs: [{ q: "Do you serve St. George?", a: CANYON_WALL }] },
    research: null,
    cssHref: "",
  });
  const page = out.files["faq.html"].toString("utf8");
  assert.ok(page, "/faq ships");
  assert.ok(!page.includes(CANYON_WALL), "the full wall must not reach the authority page");
  assert.match(page, /Emergency plumbing service for St\. George homes\.<\/p>/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page)[1]);
  const faqNode = (Array.isArray(ld["@graph"]) ? ld["@graph"] : [ld]).find((n) => n["@type"] === "FAQPage");
  assert.ok(faqNode, "FAQPage schema present");
  assert.ok(faqNode.mainEntity[0].acceptedAnswer.text.length <= 300);
});

// ---- BUG E: masthead decor artifact ---------------------------------------

const NEVADA_MASTHEAD = `<header class="masthead">
<div class="masthead-eyebrow">36.1989, -115.2811</div>
<h1 class="hero-title">Las Vegas Plumbing Pros</h1>
<span class="hero-decor">#0ea5e9</span>
<div class="hero-note">Ask for Mike · Las Vegas, NV</div>
<span class="coords">47.452589, -122.248138</span>
<div class="hero-decor">{{GEO}}</div>
</header>`;

test("data-shaped decor nodes in the masthead are suppressed; real copy survives", () => {
  const { html, suppressed } = stripMastheadDecorArtifacts(NEVADA_MASTHEAD);
  assert.equal(suppressed, 4, "eyebrow coords, hex decor, coords span and GEO token all suppressed");
  assert.ok(!html.includes("36.1989"), "coordinate artifact gone");
  assert.ok(!html.includes("#0ea5e9"), "hex artifact gone");
  assert.ok(!html.includes("{{GEO}}"), "placeholder token gone");
  assert.match(html, /<h1 class="hero-title">Las Vegas Plumbing Pros<\/h1>/, "the real heading survives untouched");
  assert.match(html, /Ask for Mike · Las Vegas, NV/, "a decor node with ordinary words is not decor-artifact");
  const hidden = html.match(/data-wss-decor-suppressed="1"/g) || [];
  assert.equal(hidden.length, 4);
  assert.match(html, /style="display:none" aria-hidden="true" data-wss-decor-suppressed="1"/);
});

test("an already-suppressed node is never double-processed", () => {
  const once = stripMastheadDecorArtifacts(NEVADA_MASTHEAD).html;
  const second = stripMastheadDecorArtifacts(once);
  assert.equal(second.suppressed, 0, "idempotent");
  assert.equal(second.html, once);
});

test("a price, a year or a street number is not mistaken for a coordinate", () => {
  const { html, suppressed } = stripMastheadDecorArtifacts(
    '<div class="hero-note">Serving Las Vegas since 1998 · from $19.99 · 635 Industry Dr</div>',
  );
  assert.equal(suppressed, 0);
  assert.match(html, /Serving Las Vegas since 1998 · from \$19\.99 · 635 Industry Dr/);
});

test("inject() suppresses the artifact on every page and reports it", () => {
  const out = inject({
    files: {
      "index.html": Buffer.from(`<!doctype html><html><head></head><body>${NEVADA_MASTHEAD}</body></html>`),
      "about.html": Buffer.from('<!doctype html><html><head></head><body><div class="hero-decor">36.1989, -115.2811</div></body></html>'),
    },
    content: { services: [{ name: "Drain Cleaning" }] },
    facts,
    slug: "canyon-plumbing",
  });
  assert.equal(out.report.decor_artifacts.suppressed, 5, "the masthead's 4 artifact nodes plus about's 1");
  assert.deepEqual(out.report.decor_artifacts.pages, ["index.html", "about.html"]);
  const home = out.files["index.html"].toString("utf8");
  assert.ok(!home.includes("36.1989"));
  assert.match(home, /Las Vegas Plumbing Pros/, "real masthead content survives the pass");
  assert.match(out.files["about.html"].toString("utf8"), /data-wss-decor-suppressed="1"/);
});
