"use strict";

// THE SERVICES WERE ON THE PAGE THE WHOLE TIME.
//
// Acceptance run 2026-08-20: five of ten builds refused service_floor while
// every one of the five homepages served its services in plain HTML. Three
// parser doors were rusted shut and are pinned open here, each with the proof
// that the door still refuses what it must:
//   1. anchor inner-markup cap 120→600 (Marcos Medical: 146/172 anchors carry
//      an SVG chevron; the whole treatment menu was invisible)
//   2. same-origin judged by the FINAL fetched URL (drjosebarrera 301s
//      www→apex and writes absolute apex links; all 181 refused cross-origin)
//   3. the catalogue directory outranks the header menu at the 12-cap
// Plus the harvest-side doors (heading prefix vocabulary, region bytes).
const test = require("node:test");
const assert = require("node:assert/strict");
const { firstPartySite } = require("../lib/mirror-engine/verified-facts");
const { harvestPageServices } = require("../lib/mirror-engine/service-harvest");

function fetchStub(html, { finalUrl } = {}) {
  return async (url) => ({
    ok: true,
    status: 200,
    url: finalUrl || url,
    text: async () => html,
  });
}

const CTX = (html, over = {}) => ({
  website: "https://www.example-med.com/",
  business_name: "Example Med Spa",
  city: "San Antonio",
  state: "TX",
  fetchImpl: fetchStub(html, over),
});

test("an icon-laden builder menu anchor is read — the label gate still rules", async () => {
  const chevron = '<span class="menu-label"><span>' + " ".repeat(40) + '</span><svg viewBox="0 0 24 24" class="chev"><path d="M8 5l8 7-8 7z" fill="currentColor"></path></svg></span>';
  const html = [
    "<nav>",
    `<a href="/services/botox/">${chevron}Botox Injections</a>`,
    `<a href="/services/hydrafacial/">${chevron}HydraFacial</a>`,
    "</nav>",
  ].join("");
  const out = await firstPartySite(CTX(html));
  const names = (out.observations.services || []).map((s) => s.name);
  assert.ok(names.includes("Botox Injections"), `SVG chevron markup must not hide the label: ${JSON.stringify(names)}`);
  assert.ok(names.includes("HydraFacial"));

  // PAIRED: the bound is real — a monster anchor is still refused.
  const monster = `<a href="/services/thing/">${"x".repeat(700)}Thing Service</a>`;
  const out2 = await firstPartySite(CTX(`<nav>${monster}</nav>`));
  assert.equal((out2.observations.services || []).length, 0, "an anchor over the 600-char markup bound stays unread");
});

test("same-origin is the origin the bytes CAME FROM — www→apex sites keep their menu", async () => {
  const html = [
    '<a href="https://example-med.com/cosmetic/facelift/">Facelift</a>',
    '<a href="https://example-med.com/cosmetic/rhinoplasty/">Rhinoplasty</a>',
    '<a href="https://unrelated-site.com/services/roofing/">Roof Repair</a>',
  ].join("");
  const out = await firstPartySite(CTX(html, { finalUrl: "https://example-med.com/" }));
  const names = (out.observations.services || []).map((s) => s.name);
  assert.ok(names.includes("Facelift"), `apex links after a www 301 are the client's own: ${JSON.stringify(names)}`);
  assert.ok(names.includes("Rhinoplasty"));
  assert.ok(!names.includes("Roof Repair"), "a genuinely foreign domain is still refused — the door did not loosen");
});

test("the catalogue directory outranks the header menu at the 12-cap", async () => {
  const stray = [
    '<a href="/press/media-mentions/">Media Mentions Gallery</a>',
    '<a href="/forms/patient-intake/">Patient Intake Form</a>',
  ];
  const catalogue = Array.from({ length: 14 }, (_, i) =>
    `<a href="/cosmetic/procedure-${i}/">Cosmetic Procedure ${String.fromCharCode(65 + i)}</a>`);
  const out = await firstPartySite(CTX([...stray, ...catalogue].join("")));
  const names = (out.observations.services || []).map((s) => s.name);
  assert.equal(names.length, 12, "the cap holds");
  assert.ok(names.every((n) => n.startsWith("Cosmetic Procedure")),
    `the 14-sibling catalogue beats two document-order strays: ${JSON.stringify(names)}`);
});

test("a brand-prefixed services heading opens the region — and is not its own first card", () => {
  const html = [
    "<h2>Houston Concrete Company Services We Provide?</h2>",
    "<div><h3>Stamped &amp; Stained Concrete</h3><h3>Driveway Repair</h3></div>",
  ].join("");
  const got = harvestPageServices({ html, ldNodes: [] });
  const names = got.services.map((s) => s.name.toLowerCase());
  assert.ok(names.some((n) => n.includes("stamped")), `region must open on a prefixed heading: ${JSON.stringify(names)}`);
  assert.ok(names.some((n) => n.includes("driveway repair")));
  assert.ok(!names.some((n) => n.includes("services we provide")), "the section title is never its own card");
});

test("'Cosmetic Procedures' is a services heading — medical vocabulary counts", () => {
  const html = "<h2>Cosmetic Procedures</h2><div><h3>Facelift Surgery</h3><h3>Rhinoplasty Consultation</h3></div>";
  const got = harvestPageServices({ html, ldNodes: [] });
  const names = got.services.map((s) => s.name.toLowerCase());
  assert.ok(names.some((n) => n.includes("facelift")), JSON.stringify(names));
});

test("the region reaches builder-fat markup at 30KB — and still ends at 40KB", () => {
  const filler = "<div>" + "p".repeat(30000) + "</div>";
  const far = "<div>" + "q".repeat(45000) + "</div>";
  const inside = harvestPageServices({ html: `<h2>Our Services</h2>${filler}<h3>Sod Installation</h3>`, ldNodes: [] });
  assert.ok(inside.services.some((s) => /sod installation/i.test(s.name)),
    "an Elementor page's card at 30KB is inside the section");
  const outside = harvestPageServices({ html: `<h2>Our Services</h2>${far}<h3>Sod Installation</h3>`, ldNodes: [] });
  assert.ok(!outside.services.some((s) => /sod installation/i.test(s.name)),
    "the region is still bounded — 45KB past the marker is not the services section");
});
