"use strict";

// test/project-gallery.test.js — FEATURE 4: the before/after project gallery.
//
// The contract under test:
//   · facts.project_photos with >=1 complete pair renders a paired gallery
//     section: BEFORE/AFTER labels, side-by-side panes, captions, lazy images.
//   · Absent field / empty array / zero complete pairs -> the section is
//     ABSENT. Conditional rendering is the feature, not a fallback.
//   · The facts boundary (validateFacts) refuses junk URLs with named 422
//     detail: not-https, not-an-image, whitespace/control chars, non-public
//     hosts, incomplete pairs, forbidden characters in captions.
//   · Injection is idempotent: a second pass changes nothing.
//   · The schema accepts well-formed project_photos and rejects malformed
//     shapes before the engine ever sees them.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProjectGallery,
  injectProjectGallery,
  completePairs,
  GALLERY_MARKER,
} = require("../lib/mirror-engine/project-gallery");
const { validateFacts, plausibleProjectPhotoUrl } = require("../lib/mirror-engine/facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { buildHash } = require("../lib/mirror-engine/build-hash");

const BASE_FACTS = { business_name: "Harbor Line Contracting", industry: "Deck Builder", city: "Spokane", state: "WA" };
const GOOD_PAIR = {
  before_url: "https://cdn.harborline.example/deck-before.jpg?w=1200",
  after_url: "https://cdn.harborline.example/deck-after.jpg",
  caption: "Rogers deck rebuild, finished in three days",
};
const PAIR_NO_CAPTION = {
  before_url: "https://images.unsplash.com/photo-pergola-before",
  after_url: "https://images.unsplash.com/photo-pergola-after",
};

function factsWith(photos) {
  return { ...BASE_FACTS, ...(photos === undefined ? {} : { project_photos: photos }) };
}

test("gallery renders paired cards with BEFORE/AFTER labels and captions", () => {
  const html = buildProjectGallery({ facts: factsWith([GOOD_PAIR, PAIR_NO_CAPTION]) });
  assert.ok(html, "section renders for two complete pairs");
  assert.ok(html.includes(`data-wss-gallery="v1"`), "idempotence marker present");
  assert.ok(html.includes("wss-ba__tag--before"), "BEFORE label");
  assert.ok(html.includes("wss-ba__tag--after"), "AFTER label");
  assert.ok(html.includes(">Before</span>"), "visible Before text");
  assert.ok(html.includes(">After</span>"), "visible After text");
  assert.ok(html.includes("Rogers deck rebuild, finished in three days"), "caption rendered");
  // Two pairs -> 4 images, every one lazy + async-decoded.
  assert.equal((html.match(/<img\b/g) || []).length, 4, "two panes per pair");
  assert.equal((html.match(/loading="lazy"/g) || []).length, 4, "gallery images are lazy");
  assert.equal((html.match(/decoding="async"/g) || []).length, 4, "async decoding");
  // Accessibility: labelled section, descriptive alt on both panes.
  assert.ok(html.includes('aria-labelledby="wss-ba-h"'));
  assert.ok(/alt="[^"]*— before/.test(html), "before alt");
  assert.ok(/alt="[^"]*— after/.test(html), "after alt");
});

test("gallery is ABSENT when the field is absent, empty, or holds no complete pair", () => {
  assert.equal(buildProjectGallery({ facts: { ...BASE_FACTS } }), "", "absent field -> absent section");
  assert.equal(buildProjectGallery({ facts: factsWith([]) }), "", "empty array -> absent section");
  assert.equal(
    buildProjectGallery({ facts: factsWith([{ before_url: "https://x/a.jpg" }]) }),
    "",
    "pair missing after_url -> absent section (validateFacts would have refused it anyway)",
  );
  assert.equal(completePairs({ ...BASE_FACTS }).length, 0, "no pairs counted");
  assert.equal(completePairs(factsWith([GOOD_PAIR])).length, 1, "one complete pair counted");
});

test("gallery injection anchors before a static footer, before </body> on a prerendered app, and is idempotent", () => {
  const facts = factsWith([GOOD_PAIR]);
  const staticPage = "<html><head></head><body><main>…</main><footer>© donor</footer></body></html>";
  const one = injectProjectGallery({ files: { "index.html": staticPage }, facts });
  assert.equal(one.report.present, true);
  assert.equal(one.report.pages, 1);
  assert.ok(one.files["index.html"].indexOf('data-wss-gallery="v1"') < one.files["index.html"].indexOf("<footer"), "section sits above the footer");

  const twice = injectProjectGallery({ files: one.files, facts });
  assert.equal(twice.report.reason, "already_present", "second pass reports presence, does not re-inject");
  assert.equal(twice.files["index.html"], one.files["index.html"], "second pass changes no bytes");

  // Prerendered SPA: a footer inside the hydration root must NOT earn the
  // static insert (the React #418 lesson) — the </body> anchor is used.
  const spaPage = '<html><head></head><body><div id="root"><footer>© donor</footer></div><script src="app.js"></script></body></html>';
  const spa = injectProjectGallery({ files: { "index.html": spaPage }, facts });
  assert.equal(spa.report.present, true);
  assert.ok(
    spa.files["index.html"].indexOf(`data-wss-gallery="v1"`) > spa.files["index.html"].indexOf('<script src="app.js">'),
    "spa section lands outside the hydration root",
  );
  assert.ok(
    spa.files["index.html"].indexOf("data-wss-gallery") < spa.files["index.html"].lastIndexOf("</body>"),
    "spa section is anchored before </body>",
  );

  // No </body> to anchor to: honest refusal, no mangling.
  const anchorless = injectProjectGallery({ files: { "index.html": "<html><body>…</body>" }, facts: factsWith([GOOD_PAIR]) });
  assert.equal(anchorless.report.present, true);
  const noBody = injectProjectGallery({ files: { "index.html": "<p>fragment</p>" }, facts: factsWith([GOOD_PAIR]) });
  assert.equal(noBody.report.present, false);
  assert.equal(noBody.files["index.html"], "<p>fragment</p>", "unanchored page unchanged");
});

test("facts boundary: good pairs pass and normalize; captions are apostrophe-normalized", () => {
  const r = validateFacts({ facts: factsWith([GOOD_PAIR, PAIR_NO_CAPTION]) });
  assert.equal(r.ok, true, JSON.stringify(r.detail || {}));
  assert.equal(r.facts.project_photos.length, 2);
  assert.equal(r.facts.project_photos[1].caption, undefined, "caption omitted when absent");
  const withApo = validateFacts({ facts: factsWith([{ ...GOOD_PAIR, caption: "Mike's deck, before and after" }]) });
  assert.equal(withApo.ok, true);
  assert.equal(withApo.facts.project_photos[0].caption, "Mike’s deck, before and after", "straight apostrophe normalized");
});

test("facts boundary: junk URLs are rejected with named reasons", () => {
  const cases = [
    [{ ...GOOD_PAIR, before_url: "http://cdn.example.com/a.jpg" }, "project_photo_url_not_https"],
    [{ ...GOOD_PAIR, before_url: "https://evil.example.com/downloads/payload.exe" }, "project_photo_url_not_plausibly_an_image"],
    [{ ...GOOD_PAIR, before_url: "data:image/png;base64,iVBOR" }, "project_photo_url_not_https"],
    [{ ...GOOD_PAIR, before_url: "https://cdn.example.com/pic (1).jpg" }, "project_photo_url_has_whitespace_or_control_chars"],
    [{ ...GOOD_PAIR, before_url: "https://localhost/a.jpg" }, "project_photo_url_host_not_public"],
    [{ ...GOOD_PAIR, before_url: "https://192.168.1.10/a.jpg" }, "project_photo_url_host_not_public"],
    [{ ...GOOD_PAIR, before_url: "not a url at all" }, "project_photo_url_unparseable"],
    [{ before_url: "https://cdn.example.com/a.jpg", after_url: "" }, "project_photo_url_blank"],
  ];
  for (const [pair, reason] of cases) {
    const r = validateFacts({ facts: factsWith([pair]) });
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(pair)}`);
    assert.equal(r.error, "invalid_facts");
    assert.equal(r.detail[0].reason, reason, `named reason for ${JSON.stringify(pair)}`);
  }
  // A non-object entry and a non-array field are caller defects too.
  const notArray = validateFacts({ facts: factsWith("https://cdn.example.com/a.jpg") });
  assert.equal(notArray.ok, false);
  assert.equal(notArray.detail[0].reason, "project_photos_not_an_array");
  const notObject = validateFacts({ facts: factsWith(["https://cdn.example.com/a.jpg"]) });
  assert.equal(notObject.ok, false);
  assert.equal(notObject.detail[0].reason, "project_photo_not_an_object");
  // Forbidden characters in a caption.
  const evilCaption = validateFacts({ facts: factsWith([{ ...GOOD_PAIR, caption: "Nice <script>alert(1)</script> deck" }]) });
  assert.equal(evilCaption.ok, false);
  assert.equal(evilCaption.detail[0].reason, "forbidden_characters");
});

test("facts boundary: empty array reads as honest absence, not an error", () => {
  const r = validateFacts({ facts: factsWith([]) });
  assert.equal(r.ok, true);
  assert.equal("project_photos" in r.facts, false, "empty array deleted");
});

test("known media hosts without an extension are accepted", () => {
  for (const url of [
    "https://abc123.supabase.co/storage/v1/object/public/gallery/before-and-after",
    "https://res.cloudinary.com/demo/image/upload/c_fill,w_800/deck",
    "https://bucket.s3.us-east-1.amazonaws.com/projects/deck",
    "https://lh3.googleusercontent.com/a/ACg8ocK",
  ]) {
    assert.equal(plausibleProjectPhotoUrl(url).ok, true, url);
  }
});

test("schema: well-formed project_photos validate; malformed shapes are 400s", () => {
  const ok = checkMirrorRequest({
    slug: "harbor-line-contracting-spokane",
    facts: { ...BASE_FACTS, project_photos: [GOOD_PAIR] },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.body || {}));
  const badUrl = checkMirrorRequest({
    slug: "harbor-line-contracting-spokane",
    facts: { ...BASE_FACTS, project_photos: [{ before_url: "http://x/a.jpg", after_url: "https://x/b.jpg" }] },
  });
  assert.equal(badUrl.ok, false, "schema refuses non-https pair URL");
  const extraKey = checkMirrorRequest({
    slug: "harbor-line-contracting-spokane",
    facts: { ...BASE_FACTS, project_photos: [{ ...GOOD_PAIR, sneaky: 1 }] },
  });
  assert.equal(extraKey.ok, false, "schema is closed to extra item keys");
  const missingAfter = checkMirrorRequest({
    slug: "harbor-line-contracting-spokane",
    facts: { ...BASE_FACTS, project_photos: [{ before_url: "https://x/a.jpg" }] },
  });
  assert.equal(missingAfter.ok, false, "schema requires both URLs");
});

test("project_photos participate in the build hash: different photos -> different build", () => {
  const withPhotos = buildHash({ donor: "d", donorHash: "dh", facts: factsWith([GOOD_PAIR]) });
  const withoutPhotos = buildHash({ donor: "d", donorHash: "dh", facts: { ...BASE_FACTS } });
  const otherPhotos = buildHash({ donor: "d", donorHash: "dh", facts: factsWith([PAIR_NO_CAPTION]) });
  assert.notEqual(withPhotos, withoutPhotos, "gallery facts change the bytes the customer receives");
  assert.notEqual(withPhotos, otherPhotos, "different pairs are different builds");
});

// ---------------------------------------------------------------------------
// END-TO-END (dry run): a REAL engine build carries the gallery report and
// the perf pipeline report in its own checks — the same evidence an operator
// reads on the manifest. Zero network calls by the dry-run contract.
// ---------------------------------------------------------------------------
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-gallery-"));
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");

const DONORS_CLEAN = path.join(__dirname, "..", "donors-clean");
const REQUEST = {
  slug: "wss-test-gallery-ridge-concrete",
  donor: "concrete-elconstruction",
  facts: {
    business_name: "Gallery Ridge Concrete",
    industry: "concrete",
    city: "Boise",
    state: "ID",
    phone: "(208) 555-0161",
    project_photos: [
      {
        before_url: "https://cdn.gallery-ridge.example/driveway-before.jpg",
        after_url: "https://cdn.gallery-ridge.example/driveway-after.jpg",
        caption: "Cracked driveway poured new in two days",
      },
    ],
  },
};

test("a real dry-run build renders the gallery and runs the perf pipeline", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    const res = await mirror(REQUEST, { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 200, `${res.body && res.body.error} ${JSON.stringify((res.body && res.body.detail) || "").slice(0, 300)}`);
    const report = res.body.checks.content.project_gallery;
    assert.equal(report.present, true, "gallery emitted on a real build");
    assert.equal(report.pairs, 1);
    assert.equal(report.pages, 1);
    const perf = res.body.checks.content.perf_pipeline;
    assert.equal(perf.status, "applied");
    assert.ok(perf.pages_transformed >= 1, "every html page went through the pipeline");

    // THE FLAG IS A KILL SWITCH: MIRROR_PROJECT_GALLERY=0 ships the same
    // build with the section absent and the absence named.
    process.env.MIRROR_PROJECT_GALLERY = "0";
    try {
      const flagged = await mirror(REQUEST, { dryRun: true, registry: createRegistry() });
      assert.equal(flagged.status, 200);
      assert.equal(flagged.body.checks.content.project_gallery.present, false);
      assert.equal(flagged.body.checks.content.project_gallery.reason, "disabled_by_flag");
    } finally {
      delete process.env.MIRROR_PROJECT_GALLERY;
    }
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("a build with no project_photos reports the honest absence, not a gallery", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    const { project_photos: _dropped, ...facts } = REQUEST.facts;
    const res = await mirror({ ...REQUEST, facts }, { dryRun: true, registry: createRegistry() });
    assert.equal(res.status, 200);
    const report = res.body.checks.content.project_gallery;
    assert.equal(report.present, false);
    assert.equal(report.reason, "no_project_photos");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});

test("junk project_photos 422 at the engine door, before any build work", async () => {
  const prev = process.env.MIRROR_DONOR_ROOT;
  process.env.MIRROR_DONOR_ROOT = DONORS_CLEAN;
  try {
    // https passes the schema's URI shape; the .exe path fails the facts
    // boundary's plausibility check — that is the 422 under test.
    const res = await mirror(
      { ...REQUEST, facts: { ...REQUEST.facts, project_photos: [{ before_url: "https://files.example/payload.exe", after_url: "https://ok.example/y.jpg" }] } },
      { dryRun: true, registry: createRegistry() },
    );
    assert.equal(res.status, 422);
    assert.equal(res.body.error, "invalid_facts");
    assert.match(res.body.detail[0].path, /project_photos\/0\/before_url/);
    assert.match(res.body.detail[0].reason, /plausibly_an_image/);
  } finally {
    if (prev === undefined) delete process.env.MIRROR_DONOR_ROOT;
    else process.env.MIRROR_DONOR_ROOT = prev;
  }
});
