"use strict";
// THE TRUST-SIGNAL BADGE STRIP — the client's OWN award/certification artwork.
//
// texasbestfence.com's homepage carries a large carousel of award and
// certification badges (AFA Pro Award, BBB A+, Best of Denton County…) — a
// trust surface the mirror used to shrink to a single 40px chip thumbnail.
// These tests pin the new strip renderer AND the gate it must never weaken:
// an <img> renders ONLY when the badge asset is hosted on the client's own
// registrable domain over https (prideBadgeImage), because this codebase has
// already served Mastercool's and Google Blogger's marks as a client's own
// identity with every gate green. Zero badges = no section. One badge = the
// chip thumbnail exactly as before. Two or more = the labeled strip.
// VISUAL ONLY: no schema.org node may ever carry a badge — self-published
// award/rating structured data is a schema violation.

const test = require("node:test");
const assert = require("node:assert");

const { buildContentHtml, buildJsonLd } = require("../lib/mirror-engine/content-inject");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

// A deliberately fictitious client. The registrable domain is what the gate
// compares, so the fixture exercises www-host vs bare-host too.
const FACTS = {
  business_name: "Test Fence Co",
  industry: "fencing",
  city: "Denton",
  state: "TX",
  phone: "+19405550000",
  website: "https://www.testfence-example.com/",
};

const OWN = (file) => `https://www.testfence-example.com/wp-content/uploads/${file}`;
const cred = (label, image) => ({ kind: "credential", label, ...(image ? { image } : {}) });

const render = (credentials, over = {}) => buildContentHtml({
  content: { pride: { schema: "owner-pride-v1", sections: { credentials } }, ...over },
  facts: FACTS,
  phoneDigits: "9405550000",
  donorRenders: [],
});

const stripItems = (html) => (html.match(/class="wss-bs__item"/g) || []).length;
const hasStrip = (html) => /data-wss-pride="badge-strip"/.test(html);

// ---------------------------------------------------------------------------
// PAIR 1: renders when present / absent when none
// ---------------------------------------------------------------------------

test("two-plus client-hosted badge images render the Awards & certifications strip", () => {
  const html = render([
    cred("AFA Pro Award", OWN("afa-pro.png")),
    cred("Best of Denton County", OWN("best-of-denton.png")),
    cred("BBB A+ Accredited", OWN("bbb-a-plus.png")),
    cred("License #40291"), // text-only: stays in the chip wall
  ]);
  assert.ok(hasStrip(html), "the strip section renders");
  assert.match(html, /<section class="wss-c wss-bs" id="badges" aria-labelledby="wss-badges-h"/);
  assert.match(html, /Awards &amp; certifications/, "the section is labeled");
  assert.equal(stripItems(html), 3, "one evenly sized item per gated image");
  // Every mark ships with its verbatim label — badge artwork is often
  // unreadable at strip size, and the label is the proven fact.
  assert.match(html, /AFA Pro Award/);
  assert.match(html, /Best of Denton County/);
  assert.match(html, /BBB A\+ Accredited/);
  // The image renders in the strip and ONLY the strip — not duplicated back
  // into the credential chip wall.
  for (const file of ["afa-pro.png", "best-of-denton.png", "bbb-a-plus.png"]) {
    const hits = html.split(OWN(file)).length - 1;
    assert.equal(hits, 1, `${file} appears exactly once`);
  }
  // The text-only credential still renders as a chip in the wall.
  assert.match(html, /License #40291/);
  assert.match(html, /wss-p__badges/, "the chip wall still exists for text credentials");
});

test("zero badge images renders no strip section at all", () => {
  const html = render([
    cred("License #40291"),
    cred("Factory-Trained Technicians"),
  ]);
  assert.ok(!hasStrip(html), "no images, no strip");
  assert.equal(stripItems(html), 0);
  assert.ok(!html.includes('id="badges"'));
  // The credentials themselves still render — as words in the wall.
  assert.match(html, /License #40291/);
});

test("a single gated image stays a chip thumbnail — no strip for one mark", () => {
  const html = render([
    cred("AFA Pro Award", OWN("afa-pro.png")),
    cred("License #40291"),
  ]);
  assert.ok(!hasStrip(html), "one badge is not a carousel");
  assert.ok(html.includes(OWN("afa-pro.png")), "the client's own asset still renders as before");
  assert.match(html, /wss-badge img|wss-p__badge/, "as the chip-wall thumbnail");
});

// ---------------------------------------------------------------------------
// PAIR 2: the ownership gate is not weakened by the new surface
// ---------------------------------------------------------------------------

test("a manufacturer-hosted mark is refused and never counts toward the strip", () => {
  // Two third-party marks + one own: only ONE image survives the gate, so no
  // strip renders — the third-party artwork must not be what tips the count.
  const one = render([
    cred("AFA Pro Award", OWN("afa-pro.png")),
    cred("HomeAdvisor Elite Service", "https://badges.homeadvisor.com/elite.png"),
    cred("Mastercool Authorized Dealer", "https://www.mastercool.com/badge.png"),
  ]);
  assert.ok(!hasStrip(one), "third-party images never tip the 2+ threshold");
  assert.ok(!one.includes("homeadvisor.com"), "HomeAdvisor's mark is not served");
  assert.ok(!one.includes("mastercool.com"), "Mastercool's mark is not served — the incident this gate exists for");
  assert.match(one, /HomeAdvisor Elite Service/, "the credential still renders — as words");
  assert.match(one, /Mastercool Authorized Dealer/, "so does this one");

  // Two own + one third-party: the strip renders with EXACTLY the two owned
  // marks, and the manufacturer's URL appears nowhere in the emitted block.
  const two = render([
    cred("AFA Pro Award", OWN("afa-pro.png")),
    cred("Best of Denton County", OWN("best-of-denton.png")),
    cred("Mastercool Authorized Dealer", "https://www.mastercool.com/badge.png"),
  ]);
  assert.ok(hasStrip(two));
  assert.equal(stripItems(two), 2, "only the owned marks are on the shelf");
  assert.ok(!two.includes("mastercool.com"));
});

test("http:// on the client's own domain is still refused", () => {
  // prideBadgeImage requires https; a schema 400 on an http:// image URL has
  // already killed a whole build once. The strip must not resurrect the URL.
  const html = render([
    cred("AFA Pro Award", "http://www.testfence-example.com/wp-content/uploads/afa-pro.png"),
    cred("Best of Denton County", "http://www.testfence-example.com/wp-content/uploads/best-of-denton.png"),
  ]);
  assert.ok(!hasStrip(html), "http images do not count");
  assert.ok(!html.includes("http://www.testfence-example.com"), "and are never served");
  assert.match(html, /AFA Pro Award/, "labels render as words");
});

// ---------------------------------------------------------------------------
// VISUAL ONLY — no structured data for badges
// ---------------------------------------------------------------------------

test("badges emit NO structured data — no award node, no badge URL in the graph", () => {
  const content = {
    pride: {
      schema: "owner-pride-v1",
      sections: {
        credentials: [
          cred("AFA Pro Award", OWN("afa-pro.png")),
          cred("Best of Denton County", OWN("best-of-denton.png")),
        ],
      },
    },
  };
  const ld = buildJsonLd({
    content,
    facts: FACTS,
    phoneDigits: "9405550000",
    siteUrl: "https://wss-test-test-fence.wss-ai.com/",
    logoUrl: "",
  });
  const serialized = JSON.stringify(ld);
  assert.ok(!serialized.includes("afa-pro.png"), "no badge asset in the schema graph");
  assert.ok(!serialized.includes("best-of-denton.png"));
  assert.ok(!/"award"/i.test(serialized), "no schema.org award property");
  assert.ok(!serialized.includes("AFA Pro Award"), "no award label smuggled into a schema node");
});

// ---------------------------------------------------------------------------
// The request schema door stays open for what the renderer consumes
// ---------------------------------------------------------------------------

test("the request schema accepts a pride block whose credentials carry client-hosted images", () => {
  const got = checkMirrorRequest({
    slug: "wss-test-test-fence",
    donor: "hvac-premier",
    facts: {
      business_name: FACTS.business_name,
      industry: "fencing",
      city: "Denton",
      state: "TX",
      phone: "+1 940 555 0000",
    },
    brand: { logo: OWN("logo.png") },
    content: {
      pride: {
        schema: "owner-pride-v1",
        sections: {
          credentials: [
            { kind: "credential", label: "AFA Pro Award", image: OWN("afa-pro.png") },
            { kind: "credential", label: "Best of Denton County", image: OWN("best-of-denton.png") },
          ],
        },
      },
    },
  });
  assert.equal(got.ok, true, JSON.stringify(got.body || {}).slice(0, 400));
});
