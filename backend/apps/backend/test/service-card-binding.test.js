"use strict";

// test/service-card-binding.test.js
//
// Pins DEFECT 1 of the 2026-09-02 Comet fleet audit: the shared service-grid
// components dealt a FIXED array of N editorial card bodies out with
// `pool[index % pool.length]` instead of binding each card to its own
// service. Live symptoms (Precision Plumbing + United Contractors, two
// independently generated sites — systemic):
//
//   · "№ 01 SERVICE" appeared more than once on one page (the number came
//     from the cycled template entry, so it reset every N cards);
//   · card BULLET LISTS were reused verbatim across UNRELATED services —
//     "Electronic Leak Detection" printed the drain-cleaning bullets,
//     "Re-pipe Waterlines" printed the leak/faucet/valve bullets, and
//     "24/7 Emergency Plumbing" inherited drain-cleaning bullets.
//
// The donor that shipped it is plumbing-clean's compiled bundle
// (assets/index-3WmJOtN5.js): `s0=mc.map((a,c)=>{const u=Wo[c%Wo.length];
// return{no:u.no,…,points:u.points,…}})` — the exact line this lane fixed at
// the template layer, plus the engine-side binding in
// lib/mirror-engine/service-cards.js that gives every island service its OWN
// bullet block and a build-report lint for duplicate blocks.
//
// Every service fixture below is verbatim from the audited live island.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONOR = path.join(BACKEND, "donors-clean", "plumbing-clean");
const bundle = () => fs.readFileSync(path.join(DONOR, "assets", "index-3WmJOtN5.js"), "utf8");

const { bindServiceCards, serviceCardPoints, lintServiceCardBullets } = require("../lib/mirror-engine/service-cards");
const { inject } = require("../lib/mirror-engine/content-inject");

// The live Precision Plumbing island service list (order preserved), plus the
// three services past the donor's 4-template pool that exposed the cycling.
const LIVE_SERVICES = [
  { name: "Electronic Leak Detection", description: "Precision Plumbing LLC offers Electronic Leak Detection in Las Vegas Las Vegas Valley." },
  { name: "Hydro Jetting Service", description: "Precision Plumbing LLC offers Hydro Jetting Service in Las Vegas Las Vegas Valley." },
  { name: "Trenchless Pipe Replacement" },
  { name: "Faucet & Sink Repair" },
  { name: "Garbage Disposal Repair" },
  { name: "Video Inspection & Location", description: "Precision Plumbing LLC offers Video Inspection & Location in Las Vegas Las Vegas Valley." },
  { name: "Re-pipe Waterlines" },
  { name: "24/7 Emergency Plumbing" },
].map((s) => ({ ...s, description: s.description || "" }));

test("binding: every service's bullets are generated FROM THAT SERVICE, never a sibling's block", () => {
  const { services } = bindServiceCards(LIVE_SERVICES);
  assert.equal(services.length, LIVE_SERVICES.length);
  for (const service of services) {
    assert.ok(Array.isArray(service.points) && service.points.length >= 3,
      `${service.name} left binding with no bullets`);
    for (const point of service.points) {
      assert.ok(
        point.toLowerCase().includes(service.name.toLowerCase().split(" ")[0]) ||
        point.toLowerCase().includes(service.name.toLowerCase()),
        `${service.name} carries a bullet that does not come from its own data: "${point}"`,
      );
    }
  }
  // The audited cross-contamination can never reappear: the leak-detection
  // card may not print the drain bullets and vice versa.
  const leak = services.find((s) => s.name === "Electronic Leak Detection");
  const repipe = services.find((s) => s.name === "Re-pipe Waterlines");
  for (const point of repipe.points) {
    assert.ok(!leak.points.includes(point),
      `Re-pipe Waterlines bullet reused verbatim on Electronic Leak Detection: "${point}"`);
  }
});

test("binding: numbering is sequential across the FULL card set, no resets, no duplicates", () => {
  const { services } = bindServiceCards(LIVE_SERVICES);
  const numbers = services.map((s) => s.card_no);
  assert.deepEqual(numbers, services.map((_, i) => String(i + 1).padStart(2, "0")));
  assert.equal(new Set(numbers).size, numbers.length, "duplicate card numbers in one set");
});

test("binding: bespoke points ride through untouched (1:1 wins when verified data exists)", () => {
  const bespoke = ["Camera-verified line location", "Hydro jetting at 4,000 PSI"];
  const { services } = bindServiceCards([
    { name: "Hydro Jetting Service", points: bespoke },
    { name: "Re-pipe Waterlines" },
  ]);
  assert.deepEqual(services[0].points, bespoke, "bespoke bullets were overwritten");
  assert.ok(services[1].points.every((p) => p.includes("Re-pipe Waterlines")),
    "the unbespoke sibling fell back to generated-from-own-name bullets");
});

test("binding: the live symptom shape — two services can never share a bullet block", () => {
  const { report } = bindServiceCards(LIVE_SERVICES);
  assert.deepEqual(report.duplicate_bullet_blocks, [],
    "the audited live list must lint clean: no duplicate bullet blocks across sibling cards");
});

test("lint: duplicate bullet blocks across sibling cards are REPORTED (warning, build not failed)", () => {
  const dupes = [
    { name: "Drain Cleaning", points: ["Clogs cleared", "Rooter service"] },
    { name: "Drain Cleaning", points: ["Clogs cleared", "Rooter service"] },
    { name: "Water Heaters", points: ["Tank and tankless"] },
  ];
  const report = lintServiceCardBullets(dupes);
  assert.equal(report.cards, 3);
  assert.equal(report.duplicate_bullet_blocks.length, 1, "the duplicated block must be flagged");
  assert.deepEqual(report.duplicate_bullet_blocks[0].services, ["Drain Cleaning", "Drain Cleaning"]);
  assert.equal(report.duplicate_bullet_blocks[0].shared_bullets, 2);
  // A report entry, not a throw: the lint's contract is to be visible.
  assert.doesNotThrow(() => lintServiceCardBullets(dupes));
});

test("lint: services that would print NO bullets are named in the report", () => {
  const report = lintServiceCardBullets([{ name: "" }, { name: "Real Service" }]);
  assert.deepEqual(report.empty_bullet_cards, ["card 1"]);
});

test("donor template: plumbing-clean's compiled grid binds per-service instead of cycling Wo", () => {
  const js = bundle();
  // THE BUG, verbatim: the fixed 4-body pool dealt out with index-modulo.
  assert.ok(!js.includes("points:u.points"), "the bundle still cycles template bullet-sets (points:u.points)");
  assert.ok(!js.includes("no:u.no"), "the bundle still takes card numbers from the cycled template (no:u.no)");
  // THE FIX, as shipped: sequential numbering across the full set, per-service
  // points (island points win; generated FROM THAT SERVICE otherwise), and a
  // copy fallback that is also service-derived rather than a cycled sibling's.
  assert.match(js, /no:String\(c\+1\)\.padStart\(2,"0"\)/, "card numbering must be positional across the set");
  assert.match(js, /Array\.isArray\(a\.points\)&&a\.points\.length\?a\.points\.map/, "island points must outrank generation");
  assert.match(js, /title:nm\|\|u\.title/, "titles must bind to the service's own name");
  assert.match(js, /copy:a\.description\|\|\(nm\?/, "copy fallback must derive from the service, not the cycled entry");
  // The zero-services fallback (the template's own default cards) still ships.
  assert.match(js, /Repairs & Fixtures/, "the template's default service set still backs an empty island");
});

test("donor template: same defect class fixed in roofing, plumbing-premier, fencing bundles", () => {
  const roofing = fs.readFileSync(path.join(BACKEND, "donors-clean", "roofing-falcon-clean", "assets", "index-BGg83Lvr.js"), "utf8");
  assert.ok(roofing.includes("handles:t.name?t.name+"), "roofing systems cards still print the cycled template's handles line");
  const premier = fs.readFileSync(path.join(BACKEND, "donors-clean", "plumbing-premier", "assets", "index-BAa9GPuc.js"), "utf8");
  assert.ok(premier.includes('to:e.name?"/free-quote"'), "premier ticket cards still carry a cycled CTA route");
  assert.ok(premier.includes("e.name+\" \\u2014 assessed on site, quoted before work begins\""), "premier ticket fit-copy still cycles template text");
  const fencing = fs.readFileSync(path.join(BACKEND, "donors-clean", "fencing-sterling", "assets", "index-Z0b1C-j7.js"), "utf8");
  assert.ok(fencing.includes("body:n.description&&String(n.description).trim()?[n.description]:"), "fencing detail pages still fall back to a cycled template body");
  assert.ok(fencing.includes("faqs:[]"), "fencing detail pages still borrow a sibling's FAQ set");
});

test("engine: the injected island carries per-service points and the build report carries the lint", () => {
  const files = {
    "index.html": Buffer.from('<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>'),
  };
  const out = inject({
    files,
    content: { services: LIVE_SERVICES },
    facts: { business_name: "Precision Plumbing LLC", city: "Las Vegas", state: "NV", service_area: "Las Vegas" },
    phoneDigits: "",
    slug: "wss-test-service-card-binding",
  });
  const html = out.files["index.html"].toString("utf8");
  const island = html.match(/<script id="wss-content" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(island, "the content island ships");
  const data = JSON.parse(island[1]);
  const blocks = new Set();
  for (const service of data.services) {
    assert.ok(Array.isArray(service.points) && service.points.length >= 3,
      `${service.name} shipped without its own bullet block`);
    assert.ok(!blocks.has(service.points.join("|")),
      `${service.name} shipped a bullet block identical to a sibling card`);
    blocks.add(service.points.join("|"));
  }
  assert.ok(out.report.service_cards, "the build report carries the service-card lint");
  assert.equal(out.report.service_cards.cards, LIVE_SERVICES.length);
  assert.deepEqual(out.report.service_cards.duplicate_bullet_blocks, []);
});

test("serviceCardPoints: caps and dedupes bespoke lists so a card is not a menu", () => {
  const points = serviceCardPoints({
    name: "Drain Cleaning",
    points: ["A", "a", "", "  B  ", "C", "D", "E", "F", "G"],
  });
  assert.deepEqual(points, ["A", "B", "C", "D", "E", "F"]);
});
