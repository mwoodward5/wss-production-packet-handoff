"use strict";

// test/seasonal-merchandising.test.js — locks seasonal merchandising
// (feature 10): the vertical-aware seasonal section rendered by the mirror
// engine at build time from a config table (lib/mirror-engine/seasonal.js).
//
// The laws under test:
//   · FLAG OFF BY DEFAULT — facts.features.seasonal must be EXACTLY true;
//     absent, false, or a truthy string renders nothing at all.
//   · SELECTION BY MONTH AND VERTICAL — the build month picks the cards; a
//     roofer never reads an HVAC line; an unmapped industry renders nothing.
//   · CERTIFIED SERVICES ONLY — a card renders only when the business's own
//     verified service list matches it, the copy is written around that
//     certified name, and the merchandising scanner refuses prices, offers,
//     urgency, guarantees and first person over the rendered bytes.
//   · THE ENGINE WIRES IT — a full mirror() build with the flag on ships the
//     section on the home page in the site's own palette; the same build with
//     the flag off ships none.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// GATE 4C: never stamp a test build into the real client registry. Must be set
// before the engine (and its client-isolation module) is first required.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-seasonal-"));

const seasonal = require("../lib/mirror-engine/seasonal");

// A business with an hvac-shaped service list that matches EVERY hvac card,
// so the month alone decides which card renders.
const HVAC_SERVICES = ["AC Tune-Ups", "Furnace Repair", "Thermostat Install", "AC Repair"];
const day = (month) => new Date(2026, month - 1, 15, 12, 0, 0);

// ---------------------------------------------------------------------------
test("industries map to their vertical, and unknown trades map to nothing", () => {
  assert.equal(seasonal.verticalFor("HVAC"), "hvac");
  assert.equal(seasonal.verticalFor("Heating & Air Conditioning"), "hvac");
  assert.equal(seasonal.verticalFor("Furnace repair"), "hvac");
  assert.equal(seasonal.verticalFor("Plumbing Services"), "plumbing");
  assert.equal(seasonal.verticalFor("roofing"), "roofing");
  assert.equal(seasonal.verticalFor("Landscaping & Lawn Care"), "landscaping");
  assert.equal(seasonal.verticalFor("Fence Contractor"), "fencing");
  assert.equal(seasonal.verticalFor("Electrical"), "electrical");
  assert.equal(seasonal.verticalFor("Concrete"), null);
  assert.equal(seasonal.verticalFor("Med Spa"), null);
  assert.equal(seasonal.verticalFor(""), null);
});

test("the build month selects the seasonal cards", () => {
  const pick = (month) => seasonal.seasonalCards({ industry: "hvac", services: HVAC_SERVICES, now: day(month) });
  // Late spring: pre-summer tune-up. Fall: furnace check. Shoulder: swap-over.
  assert.deepEqual(pick(5).cards.map((c) => c.id), ["pre-summer-tune-up"]);
  assert.deepEqual(pick(10).cards.map((c) => c.id), ["fall-furnace-check"]);
  assert.deepEqual(pick(3).cards.map((c) => c.id), ["shoulder-season-swap"]);
  // A month with no card in the vertical's calendar renders nothing, on record.
  const feb = pick(2);
  assert.equal(feb.cards.length, 0);
  assert.equal(feb.reason, "no_season_this_month");
  // Two cards CAN share a month; the cap keeps the section tasteful.
  const capped = seasonal.seasonalCards({ industry: "plumbing", services: ["Leak Repair", "Drain Cleaning", "Water Heater Flush", "Pipe Insulation"], now: day(4), max: 2 });
  assert.ok(capped.cards.length <= 2, "max bounds the section");
});

test("the vertical decides whose season it is — a roofer never reads an HVAC line", () => {
  const roof = seasonal.seasonalCards({
    industry: "Roofing",
    services: ["Roof Inspection", "Roof Repair"],
    now: day(5),
  });
  assert.equal(roof.vertical, "roofing");
  for (const card of roof.cards) {
    assert.ok(/storm|roof/i.test(card.id), card.id);
    assert.ok(!/furnace|tune-up|cooling/i.test(card.heading), card.heading);
  }
  const fence = seasonal.seasonalCards({ industry: "Fence Contractor", services: ["Fence Installation"], now: day(4) });
  assert.equal(fence.vertical, "fencing");
  assert.deepEqual(fence.cards.map((c) => c.id), ["spring-build-window"]);
});

test("cards render only when the business's own service list certifies them", () => {
  // May is the tune-up month, but this business lists no tune-up-shaped
  // service — so there is no card. The service list is the gate, not the flag.
  const uncertified = seasonal.seasonalCards({ industry: "hvac", services: ["AC Repair"], now: day(5) });
  assert.equal(uncertified.cards.length, 0);
  assert.equal(uncertified.reason, "no_certified_service_matches");
  // ...and with a matching service the same month certifies the card.
  const certified = seasonal.seasonalCards({ industry: "hvac", services: ["AC Maintenance"], now: day(5) });
  assert.deepEqual(certified.cards.map((c) => c.id), ["pre-summer-tune-up"]);
  assert.equal(certified.cards[0].service, "AC Maintenance");
  // No service list at all -> nothing to certify -> nothing renders.
  const none = seasonal.seasonalCards({ industry: "hvac", services: [], now: day(5) });
  assert.equal(none.cards.length, 0);
});

test("the flag is off by default and only exact true turns it on", () => {
  const html = "<html><body><main>site</main></body></html>";
  const cases = [
    ["absent", {}],
    ["false", { features: { seasonal: false } }],
    ["truthy string", { features: { seasonal: "yes" } }],
    ["1", { features: { seasonal: 1 } }],
  ];
  for (const [label, facts] of cases) {
    const out = seasonal.injectSeasonalSection({ html, facts: { ...facts, industry: "hvac" }, services: HVAC_SERVICES, now: day(5) });
    assert.equal(out.html, html, label);
    assert.equal(out.report.enabled, false, label);
    assert.equal(out.report.reason, "flag_off", label);
  }
});

test("an unmapped industry renders nothing even with the flag on", () => {
  const html = "<html><body><main>site</main></body></html>";
  const out = seasonal.injectSeasonalSection({ html, facts: { features: { seasonal: true }, industry: "Concrete" }, services: ["Slab Pour"], now: day(5) });
  assert.equal(out.html, html);
  assert.equal(out.report.reason, "no_vertical_for_industry");
});

test("the rendered section uses the site's own palette and names its cards", () => {
  const facts = { business_name: "Summit Air", city: "Tucson", state: "AZ", phone: "(520) 555-0142", phone_digits: "5205550142", features: { seasonal: true }, industry: "hvac" };
  const html = "<html><body><main>site</main></body></html>";
  const out = seasonal.injectSeasonalSection({ html, facts, services: HVAC_SERVICES, now: day(10) });
  assert.notEqual(out.html, html, "the section is injected");
  assert.ok(out.html.includes('class="wss-seasonal"'));
  assert.equal(out.report.rendered, true);
  assert.equal(out.report.vertical, "hvac");
  assert.deepEqual(out.report.cards, ["fall-furnace-check"]);
  // THE SITE'S OWN PALETTE: the accent comes from the theme's written triplet
  // first, then the site's own --accent custom property — never a hardcoded
  // brand colour and never the banned generic-blue default (2026-09-02).
  assert.ok(out.html.includes("hsl(var(--wss-accent-hsl,var(--accent,"), "the section reads the theme/site accent chain");
  assert.ok(!out.html.includes("199 89% 48%"), "no generic blue fallback");
  // The certified service is IN the copy (whichever listed service the card
  // bound to), and the CTA dials the site's own number.
  const sel = seasonal.seasonalCards({ industry: "hvac", services: HVAC_SERVICES, now: day(10) });
  for (const c of sel.cards) assert.ok(out.html.includes(c.service), c.service);
  assert.ok(out.html.includes('href="tel:5205550142"'));
  // Schema-shaped provenance for audits: which vertical, which cards.
  assert.ok(out.html.includes('data-wss-seasonal-vertical="hvac"'));
  assert.ok(out.html.includes('data-wss-seasonal="fall-furnace-check"'));
});

test("the merchandising scanner refuses offers, prices, urgency, and first person", () => {
  const services = HVAC_SERVICES;
  const selection = seasonal.seasonalCards({ industry: "hvac", services, now: day(5) });
  const section = seasonal.renderSeasonalSection({ facts: { business_name: "Summit Air", city: "Tucson" }, selection });
  assert.equal(seasonal.assertSeasonalCopyCertified({ html: section, cards: selection.cards, services }), true,
    "the catalog's own copy passes its own gate");

  const cases = [
    ["<p>Tune-ups from $89.</p>", /price figure/],
    ["<p>20% off this month.</p>", /discount claim/],
    ["<p>Free inspection with every call.</p>", /free offer/],
    ["<p>Limited time: book today.</p>", /urgency claim/],
    ["<p>All work guaranteed.</p>", /guarantee claim/],
    ["<p>We service all brands.</p>", /first-person claim/],
    ["<p>Our technicians are the best.</p>", /first-person claim/],
  ];
  for (const [injected, expected] of cases) {
    assert.throws(
      () => seasonal.assertSeasonalCopyCertified({ html: section.replace("</section>", `${injected}</section>`), cards: selection.cards, services }),
      expected,
      injected,
    );
  }

  // A card not bound to a listed service is refused even if the copy is clean.
  assert.throws(
    () => seasonal.assertSeasonalCopyCertified({
      html: section,
      cards: [{ ...selection.cards[0], service: "Duct Blaster Testing" }],
      services,
    }),
    /not bound to a service the business lists/,
  );
  // A rendered section that lost its certified service name is refused.
  assert.throws(
    () => seasonal.assertSeasonalCopyCertified({ html: "<section>generic words</section>", cards: selection.cards, services }),
    /rendered without its certified service name/,
  );
  // An empty selection must render an empty section.
  assert.equal(seasonal.assertSeasonalCopyCertified({ html: "", cards: [], services }), true);
  assert.throws(() => seasonal.assertSeasonalCopyCertified({ html: "<p>stray</p>", cards: [], services }), /empty selection/);
});

// ---------------------------------------------------------------------------
// THE ENGINE WIRES IT — the same no-network harness the donor tests use.
// ---------------------------------------------------------------------------
const { loadDonorFiles } = require("../lib/mirror-engine/donor");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { siteEditLog } = require("../lib/site-edit-log");

function makeHarness() {
  const captured = { files: null };
  const deps = {
    slugPolicy,
    siteEditLog: (args) => siteEditLog({ ...args, select: async () => ({ ok: true, mode: "live_select", data: [] }) }),
    resolveBrandAssets: async () => ({
      ok: true, logo: null, accent: null, primary: null, hashes: {}, mediaMode: "housed", photos: [], heroVideo: null,
    }),
    readArchivedFile: async () => null,
    withSpaRewrite: (files) => { captured.files = files; return files; },
    ensureProject: async () => "prj_stub",
    uploadFiles: async (files) => ({ manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 1, deduped: 0 }),
    createDeployment: async () => ({ id: "dpl_stub", url: "stub.vercel.app", readyState: "QUEUED" }),
    waitReady: async () => ({ readyState: "READY" }),
    byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
    deepLinkCheck: async () => ({ clean: true, failures: [] }),
    attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
    aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
    renderCheck: async () => ({ status: "passed", problems: [] }),
    renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
  };
  return { deps, files: () => captured.files };
}

function buildRequest({ seasonalFlag }) {
  return {
    slug: "wss-test-summit-air-tucson",
    facts: {
      business_name: "Summit Air",
      industry: "HVAC",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
      ...(seasonalFlag ? { features: { seasonal: true } } : {}),
    },
    content: { services: HVAC_SERVICES },
  };
}

async function buildWithFlag(seasonalFlag) {
  const h = makeHarness();
  const res = await mirror(buildRequest({ seasonalFlag }), { registry: createRegistry(), deps: h.deps });
  assert.equal(res.status, 200, `build was rejected: ${JSON.stringify(res.body).slice(0, 600)}`);
  return h.files();
}

test("a flagged engine build ships the seasonal section on the home page", async () => {
  const files = await buildWithFlag(true);
  assert.ok(files["index.html"], "the build shipped an index");
  const indexHtml = files["index.html"].toString("utf8");
  assert.ok(indexHtml.includes('class="wss-seasonal"'), "the seasonal section is on the home page");
  assert.ok(indexHtml.includes('data-wss-seasonal-vertical="hvac"'), "the vertical is stamped on the section");
  // Whichever month the build runs in, the card that ships is the hvac card
  // for that month, bound to a service the request certified.
  const cards = [...indexHtml.matchAll(/data-wss-seasonal="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(cards.length >= 1, "at least the current month's card shipped");
  const hvacCalendar = seasonal.SEASONAL_CATALOG.hvac.map((c) => c.id);
  for (const id of cards) assert.ok(hvacCalendar.includes(id), `${id} is an hvac catalog card`);
  // The other built HTML pages do not carry the section: seasonal is a
  // home-page surface, decided once per build.
  for (const [rel, buf] of Object.entries(files)) {
    if (/\.html?$/i.test(rel) && rel !== "index.html") {
      assert.ok(!buf.toString("utf8").includes('class="wss-seasonal"'), rel);
    }
  }
});

test("the same build with the flag off ships no seasonal section anywhere", async () => {
  const files = await buildWithFlag(false);
  for (const [rel, buf] of Object.entries(files)) {
    if (/\.html?$/i.test(rel)) {
      assert.ok(!buf.toString("utf8").includes("wss-seasonal"), `${rel} carries no seasonal markup`);
    }
  }
});
