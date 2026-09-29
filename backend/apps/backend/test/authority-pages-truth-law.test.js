"use strict";

// test/authority-pages-truth-law.test.js
//
// Opening the content pipe (from-genie -> request.content) also switched on the
// authority-page layer, and that layer would publish a whole /faq page built
// ENTIRELY from TRADE_EDU.faqExtra — two generic answers the business never
// gave — under a "By the <business> team" byline and an FAQPage schema fed to
// answer engines. Observed live on wss-test-jacksonville-roofing-usa, whose
// Genie packet contains zero FAQs.
//
// TRUTH LAW, as stated by the owner: if FAQs have no source, ship none.

const test = require("node:test");
const assert = require("node:assert/strict");
const authorityPages = require("../lib/mirror-engine/authority-pages");

const FACTS = {
  business_name: "Jacksonville Roofing USA",
  industry: "Roofing",
  city: "Jacksonville",
  state: "FL",
  phone: "(904) 516-4279",
};

function build(content) {
  return authorityPages.build({ facts: FACTS, phoneDigits: "9045164279", slug: "wss-test-jacksonville-roofing-usa", content, research: null, cssHref: "" });
}

function html(out, file) {
  return out.files[file] ? out.files[file].toString("utf8") : "";
}

test("no sourced FAQs => NO /faq page at all", () => {
  const out = build({ services: [{ name: "Roofing" }] });
  assert.ok(!out.files["faq.html"], "a /faq page must not exist without the business's own FAQs");
  assert.ok(!out.report.pages.includes("/faq"));
});

test("no sourced FAQs => the generic trade answers appear nowhere", () => {
  const out = build({ services: [{ name: "Roofing" }] });
  const all = Object.values(out.files).map((b) => b.toString("utf8")).join("\n");
  assert.ok(!all.includes("How often should a roof be inspected?"), "generic FAQ leaked onto another page");
  assert.ok(!/"@type":\s*"FAQPage"/.test(all), "no FAQPage schema may be emitted without sourced FAQs");
});

test("sourced FAQs => page ships, and FAQPage schema carries ONLY the sourced ones", () => {
  const out = build({ faqs: [{ q: "Do you handle insurance claims?", a: "Yes, we document the damage and work with your adjuster." }] });
  const page = html(out, "faq.html");
  assert.ok(page, "/faq must ship when the business has its own FAQs");
  assert.ok(page.includes("Do you handle insurance claims?"));
  // General guidance may enrich the page, but it is labelled as not theirs...
  assert.ok(page.includes("General roofing guidance"), "trade guidance must be labelled");
  assert.ok(page.includes("Industry background, not answers from Jacksonville Roofing USA"));
  // ...and never enters the schema as an answer this business gave.
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faqNode = ld["@graph"].find((n) => n["@type"] === "FAQPage");
  assert.equal(faqNode.mainEntity.length, 1, "only the sourced FAQ may be schema-claimed");
  assert.equal(faqNode.mainEntity[0].name, "Do you handle insurance claims?");
});

test("a byline is only claimed on a page carrying the business's own words", () => {
  // No about copy in the packet: the /about page is facts + trade guidance, so
  // it gets a date and no authorship claim.
  const generic = html(build({ services: [{ name: "Roofing" }] }), "about.html");
  assert.ok(generic, "/about still ships");
  assert.ok(!generic.includes("By the Jacksonville Roofing USA team"), "no byline on copy they did not write");
  assert.ok(/Last updated/.test(generic));

  // Their own story: the byline is earned.
  const authored = html(build({ about: "We have roofed Duval County homes since 1998." }), "about.html");
  assert.ok(authored.includes("By the Jacksonville Roofing USA team"));
});

test("service-areas is fact-assembled and never claims a byline", () => {
  const out = build({ areas: ["Jacksonville", "Orange Park"] });
  const page = html(out, "service-areas.html");
  assert.ok(page);
  assert.ok(!page.includes("By the Jacksonville Roofing USA team"));
});

test("no page links to an authority page that did not ship", () => {
  const out = build({ services: [{ name: "Roofing" }] }); // /about + the /roofing service page
  // Wave 4: every verified service now earns its own page, so "Roofing"
  // ships /roofing beside /about. The invariant under test is unchanged —
  // nothing may link to a page that did not ship.
  assert.deepEqual(out.report.pages, ["/about", "/roofing"]);
  for (const [file, buf] of Object.entries(out.files)) {
    const page = buf.toString("utf8");
    const hrefs = [...page.matchAll(/href="(\/[a-z0-9-]*(?:\/[a-z0-9-]*)*)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      const ok = href === "/" || out.report.pages.includes(href) || href.startsWith("/assets") || href === "/#main";
      assert.ok(ok, `${file} links to ${href}, which did not ship`);
    }
  }
});

test("links appear again once the target pages ship", () => {
  const out = build({
    about: "We have roofed Duval County homes since 1998.",
    areas: ["Jacksonville"],
    faqs: [{ q: "Insurance claims?", a: "Yes." }],
    team: [{ name: "Dana Reyes", role: "Owner" }],
  });
  for (const p of ["/about", "/service-areas", "/faq", "/team"]) assert.ok(out.report.pages.includes(p), `${p} should ship`);
  const about = html(out, "about.html");
  assert.ok(about.includes('href="/faq"'), "the FAQ cross-link returns when /faq exists");
  assert.ok(about.includes('href="/service-areas"'));
});
