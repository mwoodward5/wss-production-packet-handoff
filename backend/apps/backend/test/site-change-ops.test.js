"use strict";
// test/site-change-ops.test.js — the ops added for the real support queue.
//
// The distribution these cover is not guessed: it is the owner's actual ticket
// queue — tracking code (constantly), legal pages, photo swaps, copy changes.
// Each test below pins a property that makes one of those safe to do without a
// human in the loop, and most of them pin a failure that was MEASURED on a live
// mirror while building them rather than one that was imagined.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../lib/site-change-plan");

const SRC = fs.readFileSync(path.join(__dirname, "..", "lib", "site-change-plan.js"), "utf8");
const SHELL = '<!doctype html><html><head><meta charset="utf-8" /><title>t</title></head><body><div id="root"></div></body></html>';

// ---------------------------------------------------------------------------
// TRACKING TAGS — the narrow exception to "no script injection"
// ---------------------------------------------------------------------------
// The rail that refuses <script> in insert_html is what stops a compromised
// planner running arbitrary JS on a customer's site. These tests exist to show
// that the tracking path does not open a door through it: the customer supplies
// an identifier, the snippet is ours, and the identifier cannot express markup.

test("tracking: the customer supplies an ID, and an ID cannot express markup", () => {
  const payloads = [
    "GTM-<script>alert(1)</script>",
    'GTM-X"></script><script>fetch("//evil")',
    "GTM-ABC123'; fetch('//evil'); '",
    "GTM-ABC123</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "GTM-ABC 123",
    "GTM-ABC123\n<script>",
  ];
  for (const id of payloads) {
    assert.throws(
      () => P.validateTrackingTag({ vendor: "gtm", id }),
      /not a valid|not a tracking vendor/,
      `must refuse: ${JSON.stringify(id)}`,
    );
  }
});

test("tracking: every vendor's ID pattern is anchored and admits no markup characters", () => {
  // Not a spot check — the property is asserted for every entry in the
  // registry, so a vendor added later cannot quietly widen the hole.
  for (const [key, spec] of Object.entries(P.TRACKING_VENDORS)) {
    const src = spec.idPattern.source;
    assert.ok(src.startsWith("^") && src.endsWith("$"), `${key}: pattern must be anchored (${src})`);
    for (const ch of ['"', "'", "<", ">", "/", ";", "(", ")", " ", "\\", "&", "="]) {
      assert.ok(
        !spec.idPattern.test(`${ch}`) && !spec.idPattern.test(`x${ch}x`),
        `${key}: must never admit ${JSON.stringify(ch)}`,
      );
    }
  }
});

test("tracking: the emitted snippet only ever contacts the vendor's declared origins", () => {
  // The registry is data, and data drifts. This is re-proved against the
  // RENDERED bytes on every install, so a template edited to point elsewhere
  // fails the gate instead of shipping to customers.
  for (const [key, spec] of Object.entries(P.TRACKING_VENDORS)) {
    const rendered = `${spec.head("GTM-AAAAAAAA")}\n${spec.body ? spec.body("GTM-AAAAAAAA") : ""}`;
    assert.doesNotThrow(() => P.assertTemplateOriginsAllowed(rendered, spec), `${key} snippet must stay on-origin`);
  }
  const rogue = { label: "Rogue", origins: ["https://www.googletagmanager.com"] };
  assert.throws(
    () => P.assertTemplateOriginsAllowed('<script src="https://evil.example/x.js"></script>', rogue),
    /not one of/,
  );
});

test("tracking: a container is never installed twice, whatever the page already held", () => {
  // Two GTM loaders means every visit is counted twice and the customer makes
  // decisions on the doubled number. The guarantee is structural — install
  // STRIPS every existing region for that vendor before inserting one — so it
  // holds even when the "is it already there?" check is wrong or the page was
  // hand-edited.
  const tag = P.validateTrackingTag({ vendor: "gtm", id: "GTM-NQV5LX64" });
  const loaders = (s) => (s.match(/googletagmanager\.com\/gtm\.js/g) || []).length;

  let messy = SHELL;
  for (const old of ["GTM-OLDAAA1", "GTM-OLDAAA2", "GTM-OLDAAA3"]) {
    messy = P.insertTagInHead(messy, `<!-- wss-tag:gtm ${old} -->\n${tag.spec.head(old)}\n<!-- /wss-tag:gtm -->`);
  }
  assert.equal(loaders(messy), 3, "fixture should start dirty");
  const cleaned = P.installTrackingTag(messy, tag);
  assert.equal(loaders(cleaned.html), 1);
  assert.deepEqual(P.readInstalledTags(cleaned.html), [{ key: "gtm", id: "GTM-NQV5LX64" }]);

  // And a stale read — the writer working from an OLD copy of the page — still
  // produces exactly one. This is not hypothetical: the archive served stale
  // bytes during the live build of this feature.
  assert.equal(loaders(P.installTrackingTag(SHELL, tag).html), 1);
});

test("tracking: re-installing the same ID changes nothing; a new ID replaces the old", () => {
  const tag = P.validateTrackingTag({ vendor: "gtm", id: "GTM-NQV5LX64" });
  const once = P.installTrackingTag(SHELL, tag);
  assert.equal(once.changed, true);
  assert.equal(P.installTrackingTag(once.html, tag).changed, false, "same ID must be a no-op");

  const swapped = P.installTrackingTag(once.html, P.validateTrackingTag({ vendor: "gtm", id: "GTM-ZZZZZZ99" }));
  assert.equal(swapped.replacedId, "GTM-NQV5LX64");
  assert.deepEqual(P.readInstalledTags(swapped.html), [{ key: "gtm", id: "GTM-ZZZZZZ99" }]);
});

test("tracking: the tag lands as high in <head> as is CORRECT — after charset, before the title", () => {
  // "Paste this as high in the <head> as possible" is the customer's own
  // instruction, but charset must still come first: a parser that meets script
  // bytes before it knows the encoding can mis-decode the document.
  const html = P.installTrackingTag(SHELL, P.validateTrackingTag({ vendor: "gtm", id: "GTM-NQV5LX64" })).html;
  const at = html.indexOf("wss-tag:gtm");
  assert.ok(at > html.indexOf("charset"), "must come after the charset declaration");
  assert.ok(at < html.indexOf("<title>"), "must come before everything else in the head");
  // The noscript half goes immediately after <body>, as the vendor specifies.
  assert.match(html, /<body[^>]*>\s*<!-- wss-tag:gtm/);
});

test("tracking: a vendor we do not install is a sentence, not a crash", () => {
  const error = (() => { try { P.validateTrackingTag({ vendor: "hotjar", id: "1234567" }); } catch (e) { return e; } })();
  assert.ok(error && error.trackingRefusal);
  assert.ok(String(error.say).length > 20, "a refusal must carry something Riley can say");
  assert.doesNotMatch(String(error.say), /paste|snippet|<script/i, "never invite the caller to hand us code");
});

test("tracking: an ID alone identifies its vendor, so a mis-heard vendor name still works", () => {
  // A caller reads out "add this code, GTM-NQV5LX64" and never says the words
  // "tag manager". Bouncing that back is a refusal the customer experiences as
  // the product not working.
  assert.equal(P.validateTrackingTag({ vendor: "", id: "GTM-NQV5LX64" }).key, "gtm");
  assert.equal(P.validateTrackingTag({ vendor: "whatever", id: "G-ABCD123456" }).key, "ga4");
  assert.equal(P.validateTrackingTag({ vendor: "", id: "AW-123456789" }).key, "google_ads");
  // Case is normalised rather than rejected — nobody dictates capitals.
  assert.equal(P.validateTrackingTag({ vendor: "Google Tag Manager", id: "gtm-nqv5lx64" }).id, "GTM-NQV5LX64");
});

test("general script injection is STILL refused — the rail was routed around, not removed", () => {
  // The whole justification for the tracking op is that it does not accept
  // markup. If insert_html ever starts accepting a script, that argument is
  // void, so the refusal is pinned here as well as where it lives.
  assert.match(SRC, /insert_html: refuses to inject script, iframe or inline event handlers/);
  assert.match(SRC, /<script\|<iframe\|on\[a-z\]\+\\s\*=/);
  // And the contract must tell the planner it can never hand us code.
  assert.match(P.PLAN_CONTRACT, /NEVER pass a code snippet/);
  assert.match(P.PLAN_CONTRACT, /takes an identifier/);
});

// ---------------------------------------------------------------------------
// IMAGE INTAKE
// ---------------------------------------------------------------------------
test("images: only real raster images are accepted, and a Drive viewer page is not one", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(16)]);
  const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), Buffer.alloc(16)]);
  assert.equal(P.sniffImage(png).ext, "png");
  assert.equal(P.sniffImage(jpg).ext, "jpg");
  assert.equal(P.sniffImage(gif).ext, "gif");
  assert.equal(P.sniffImage(webp).ext, "webp");

  // THE ACTUAL TICKET: "photos from this folder [Drive link]". A Drive share
  // URL returns the viewer page, and without a sniff that HTML would be
  // uploaded and served to an <img> tag as the customer's photograph.
  assert.equal(P.sniffImage(Buffer.from("<!doctype html><html><body>Google Drive</body></html>")), null);
  // SVG is a document format that can carry script. "It is an image" is not
  // true of it in the sense that matters here.
  assert.equal(P.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
});

test("images: a supplied URL is untrusted input and is fenced accordingly", () => {
  for (const bad of [
    "http://example.com/a.jpg",          // downgrade we would be choosing for them
    "https://user:pw@example.com/a.jpg", // credentials in a link
    "https://localhost/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://[::1]/a.jpg",
    "https://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
    "not a url at all",
  ]) {
    const error = (() => { try { P.assertFetchableImageUrl(bad); } catch (e) { return e; } })();
    assert.ok(error, `must refuse ${bad}`);
    assert.equal(error.imageRefusal, true, `${bad} must be a spoken refusal`);
    assert.ok(String(error.say).length > 20, `${bad} needs a sentence`);
  }
  assert.equal(P.assertFetchableImageUrl("https://example.com/a.jpg").hostname, "example.com");
});

test("images: a swap may only name media THIS site already serves", () => {
  const assets = [{ id: "m1", path: "/assets/hero.jpg" }, { id: "m2", path: "/assets/client-logo.png" }];
  assert.equal(P.assertAssetInScope("/assets/hero.jpg", assets), "assets/hero.jpg");
  for (const bad of ["/assets/../../etc/passwd", "/assets/other-client.jpg", "assets/hero.jpg", ""]) {
    assert.throws(() => P.assertAssetInScope(bad, assets), /out of scope/);
  }
});

test("images: repointing a reference respects a boundary, so a prefix cannot be caught", () => {
  const texts = {
    "index.html": '<meta content="/assets/hero.mp4" /><link href="/assets/hero.mp4.map">',
    "assets/app.js": 'var a="/assets/hero.mp4",b="/assets/hero.mp4x";',
  };
  const hits = P.rewriteAssetReferences(texts, "/assets/hero.mp4", "/assets/hero-wss1234.mp4");
  assert.deepEqual(hits.map((h) => h.file).sort(), ["assets/app.js", "index.html"]);
  assert.ok(texts["index.html"].includes("/assets/hero.mp4.map"), "the .map sibling must be untouched");
  assert.ok(texts["assets/app.js"].includes('"/assets/hero.mp4x"'), "a longer sibling path must be untouched");
  assert.ok(texts["index.html"].includes("/assets/hero-wss1234.mp4"));
});

test("images: the hosted file is named for its CONTENT and served with an honest type", () => {
  assert.equal(P.assetStem("assets/hero-detail-fitting-CjWkqcPK.jpg"), "hero-detail-fitting");
  assert.equal(P.contentTypeFor("assets/x.png"), "image/png");
  assert.equal(P.contentTypeFor("assets/x.jpg"), "image/jpeg");
  assert.equal(P.contentTypeFor("privacy.html"), "text/html");
  assert.equal(P.contentTypeFor("sitemap.xml"), "application/xml");
});

// ---------------------------------------------------------------------------
// COPY — the words a visitor actually reads
// ---------------------------------------------------------------------------
// Measured on the live Rimrock mirror: every heading a visitor sees lives in
// the compiled bundle, not index.html. replace_text therefore could not change
// a single visible word — it would apply, move bytes, pass every gate, and
// alter nothing anyone could see.
const BUNDLE = [
  'u.jsx(_s,{n:"05",tag:"Tools",title:"A small workshop, just for you.",sub:"Plain-numbers reference tools."})',
  'u.jsx("div",{className:"mt-16 grid gap-12 lg:grid-cols-4",children:"Four steps, start to finish."})',
  'u.jsx("p",{children:"Repairs, drains and water heaters."})',
  'e.name="dup";t.title="Twice over.";q.title="Twice over.";',
  'Error("Objects are not valid as a React child")',
].join("\n");

test("copy: the catalog offers prose the visitor reads, not class lists or vendor internals", () => {
  const copy = P.buildCopyCatalog({ "assets/index-abc.js": BUNDLE });
  const texts = copy.map((c) => c.text);
  assert.ok(texts.includes("A small workshop, just for you."));
  assert.ok(texts.includes("Four steps, start to finish."));
  assert.ok(texts.includes("Repairs, drains and water heaters."));
  // Utility-class soup reads as prose to a naive filter.
  assert.ok(!texts.some((t) => /grid-cols|mt-16/.test(t)), `class strings leaked: ${JSON.stringify(texts)}`);
  // React's own error strings are not the customer's copy.
  assert.ok(!texts.some((t) => /React child/.test(t)));
  // A literal appearing twice has two answers to "change this one", so it is
  // not offered at all rather than disambiguated.
  assert.ok(!texts.includes("Twice over."), "ambiguous literals must be dropped");
});

test("copy: a replacement can change the contents of a string and provably nothing else", () => {
  // The edit substitutes bytes strictly between two quote characters that are
  // already there. The four characters that could break out of the literal are
  // refused, so this cannot alter the program.
  const out = P.applyCopyReplace(BUNDLE, { literal: "Four steps, start to finish.", replacement: "Four steps, start to done." });
  assert.ok(out.includes('children:"Four steps, start to done."'));
  assert.equal(out.length - BUNDLE.length, "Four steps, start to done.".length - "Four steps, start to finish.".length);

  for (const escape of ['a","evil":1,"x":"b', "a\\", "line\nbreak", "<script>", "a>b"]) {
    assert.throws(
      () => P.applyCopyReplace(BUNDLE, { literal: "Four steps, start to finish.", replacement: escape }),
      /may not contain/,
      `must refuse ${JSON.stringify(escape)}`,
    );
  }
  assert.throws(
    () => P.applyCopyReplace(BUNDLE, { literal: "Twice over.", replacement: "Once." }),
    /occurs 2 times/,
  );
});

test("copy: the bundle is writable only where the catalog said it was", () => {
  const scope = new Set(["assets/index-abc.js"]);
  assert.equal(P.assertBundleInScope("assets/index-abc.js", scope), "assets/index-abc.js");
  for (const bad of ["assets/other.js", "index.html", "../x.js", ""]) {
    assert.throws(() => P.assertBundleInScope(bad, scope), /out of scope/);
  }
});

test("copy_block: the planner supplies sentences, never markup", () => {
  const block = P.renderCopyBlock({
    heading: '<img src=x onerror=alert(1)>',
    paragraphs: ['</div><script>fetch("//evil")</script>'],
    bullets: ["a & b"],
    jobId: "edit_1",
  });
  // Every tag in the output must be one this file wrote. Anything the planner
  // supplied is text, so it can only appear escaped.
  const tags = [...block.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual([...new Set(tags)].sort(), ["div", "h2", "li", "p", "section", "ul"], `unexpected tag: ${tags}`);
  assert.match(block, /&lt;img/);
  assert.match(block, /&lt;script&gt;/);
  assert.match(block, /a &amp; b/);
  // It reuses the site's own content classes, so an added block matches the
  // page instead of approximating it.
  assert.match(block, /class="wss-c"/);
  assert.throws(() => P.renderCopyBlock({ jobId: "e" }), /nothing to add/);
});

// ---------------------------------------------------------------------------
// LEGAL PAGES
// ---------------------------------------------------------------------------
const FACTS = {
  businessName: "Rimrock Plumbing",
  city: "Billings",
  state: "MT",
  phone: "(406) 855-7131",
  email: "rimrockplumbing@gmail.com",
  serves: "Billings, MT",
  origin: "https://wss-test-rimrock.wss-ai.com",
  host: "wss-test-rimrock.wss-ai.com",
  services: [],
};
const render = (observations) => P.renderPrivacyPage({
  facts: FACTS,
  observations,
  today: "2026-08-07",
  styleBlock: "<style>body{color:#fff}</style>",
  accentBlock: "",
  route: "/privacy",
});
const NONE = { tags: [], googleFonts: false, maps: false, form: false, tel: false, email: false };

test("legal: a terms of service is refused, because it is a contract and not a description", () => {
  // This is the line the whole legal_page design is drawn against. A privacy
  // page DESCRIBES an artifact we built and can inspect. A terms of service
  // BINDS — it sets liability and dispute terms in the customer's name, to the
  // public, and nobody has agreed to them. The refusal is asserted here so it
  // cannot be relaxed without someone deciding to.
  assert.match(SRC, /is a contract, not a description/);
  assert.deepEqual(Object.keys(P.LEGAL_KINDS), ["privacy"]);
  assert.match(SRC, /\\bterms\\b\|\\btos\\b\|conditions\|disclaimer\|refund/);
});

test("legal: the generated page passes the same claim gate as every other generated page", () => {
  const { assertNoInventedClaims } = require("../lib/seo-page-edit");
  for (const obs of [
    NONE,
    { ...NONE, tags: [{ key: "gtm", id: "GTM-NQV5LX64" }], googleFonts: true, form: true, tel: true, email: true },
    { ...NONE, tags: [{ key: "ga4", id: "G-ABCD123456" }, { key: "meta_pixel", id: "1234567890123456" }], maps: true },
  ]) {
    assert.doesNotThrow(() => assertNoInventedClaims(render(obs), FACTS));
  }
});

test("legal: the page describes only what was OBSERVED — absence stays absence", () => {
  const bare = render(NONE);
  assert.match(bare, /No analytics or advertising tags are installed/);
  assert.match(bare, /no sign-up, no account and no login/);
  assert.ok(!/contact form/.test(bare), "must not claim a form the site does not have");
  assert.ok(!/Google Fonts/.test(bare), "must not claim a font service the site does not load");

  const rich = render({ ...NONE, tags: [{ key: "gtm", id: "GTM-NQV5LX64" }], googleFonts: true, form: true });
  assert.match(rich, /contact form/);
  assert.match(rich, /Google Tag Manager/);
  assert.match(rich, /GTM-NQV5LX64/);
  assert.match(rich, /Google Fonts/);
});

test("legal: the tag table lists exactly what is installed and invents no vendor", () => {
  const html = render({ ...NONE, tags: [{ key: "ga4", id: "G-ABCD123456" }] });
  assert.match(html, /Google Analytics 4/);
  assert.match(html, /G-ABCD123456/);
  assert.ok(!/Meta pixel|Microsoft Clarity|Google Tag Manager/.test(html), "only installed vendors may appear");
  // An unknown key recorded on a page cannot conjure a row.
  const unknown = render({ ...NONE, tags: [{ key: "not_a_vendor", id: "XYZ" }] });
  assert.match(unknown, /No analytics or advertising tags are installed/);
});

test("legal: the page never claims compliance and never promises conduct", () => {
  // The most dangerous sentence this system could publish is one asserting a
  // legal conclusion about a business it cannot see. These are absent by
  // construction and asserted so they stay absent.
  const html = render({ ...NONE, tags: [{ key: "gtm", id: "GTM-NQV5LX64" }], googleFonts: true, form: true, tel: true, email: true });
  for (const forbidden of [
    /GDPR/i, /CCPA/i, /UK ?GDPR/i, /applicable law/i, /complian(t|ce)/i,
    /never sell/i, /do not sell/i, /we will/i, /guarantee/i, /right to be forgotten/i,
    /retain(ed)? for \d+/i, /within \d+ (business )?days/i, /consent to/i,
  ]) {
    assert.ok(!forbidden.test(html), `page must not say ${forbidden}: ${(html.match(forbidden) || [])[0]}`);
  }
  // And it says plainly what it is.
  assert.match(html, /rather than a legal agreement/);
});

test("legal: the page carries its own link colour, because the inherited stylesheet has none", () => {
  // MEASURED on the first live deploy: the sub-page stylesheet styles anchors
  // only in .wss-p__bar, .wss-p__cite, .wss-c__nearlist and a.wss-p__cta, so
  // every link in body prose rendered in browser-default blue on this donor's
  // near-black page — legible only if you already knew it was there.
  const html = render({ ...NONE, tags: [{ key: "gtm", id: "GTM-NQV5LX64" }], form: true, tel: true, email: true });
  assert.match(html, /\.wss-c a\{color:hsl\(var\(--accent/);
});

test("legal: installing a tag later cannot leave the privacy page describing the old set", () => {
  // MEASURED on the live mirror: a Meta pixel installed after the privacy page
  // existed left the page listing Google Tag Manager only — a page whose whole
  // justification is that it accurately describes what the site does with
  // visitor data, quietly describing the wrong thing. A generated page that can
  // go stale is a generated lie on a delay.
  const gtm = P.validateTrackingTag({ vendor: "gtm", id: "GTM-NQV5LX64" });
  const withGtm = P.installTrackingTag(SHELL, gtm).html;
  const refresh = (fileTexts) => P.refreshPrivacyPage({ fileTexts, assetTexts: {}, facts: FACTS, today: "2026-08-07" });

  const fileTexts = { "index.html": withGtm, "privacy.html": "<!doctype html><html><body>placeholder</body></html>" };
  const settled = refresh(fileTexts);
  assert.ok(settled, "a page that does not match the site must be rewritten");
  assert.match(settled, /Google Tag Manager/);
  assert.ok(!/Meta pixel/.test(settled));

  // Once it matches the site, refreshing again is a no-op — so an unrelated
  // edit cannot churn the page or bump its date for nothing.
  fileTexts["privacy.html"] = settled;
  assert.equal(refresh(fileTexts), null);

  // Now a second tag arrives, and the page must follow it.
  fileTexts["index.html"] = P.installTrackingTag(withGtm, P.validateTrackingTag({ vendor: "meta", id: "1234567890123456" })).html;
  const next = refresh(fileTexts);
  assert.ok(next, "the page must be rewritten when the tag inventory changes");
  assert.match(next, /Meta pixel/);
  assert.match(next, /Google Tag Manager/);
});

test("legal: a pixel ID is printed so it cannot be read as a phone number", () => {
  // A Meta pixel ID is 15-16 bare digits, and the shared claim gate refuses any
  // phone-shaped run that is not the business's own number — its pattern has no
  // boundary, so it matches the first ten digits of a pixel ID. Caught by the
  // test above rather than in production: every customer running a Meta pixel
  // would have been unable to get a privacy page at all.
  assert.equal(P.printableTagId("1234567890123456"), "ending 3456");
  assert.equal(P.printableTagId("GTM-NQV5LX64"), "GTM-NQV5LX64");
  assert.equal(P.printableTagId("G-ABCD123456"), "G-ABCD123456");
  const html = render({ ...NONE, tags: [{ key: "meta_pixel", id: "1234567890123456" }] });
  assert.ok(!html.includes("1234567890123456"), "no bare 16-digit run in visible text");
  assert.match(html, /ending 3456/);
});

test("legal: the footer strip attaches at the end of the body and can be read back", () => {
  const withStrip = P.applyLegalStrip(SHELL, { links: [{ route: "/privacy", label: "Privacy" }], jobId: "j1" });
  assert.ok(withStrip.indexOf("data-wss-legal") < withStrip.lastIndexOf("</body>"));
  assert.deepEqual(P.readLegalStripLinks(withStrip), [{ route: "/privacy", label: "Privacy" }]);
  // A second legal page appends to the same strip rather than stacking strips.
  const twice = P.applyLegalStrip(withStrip, { links: [{ route: "/privacy", label: "Privacy" }, { route: "/terms", label: "Terms" }], jobId: "j2" });
  assert.equal((twice.match(/data-wss-legal/g) || []).length, 1);
  assert.equal(P.readLegalStripLinks(twice).length, 2);
});

test("legal: a form is claimed only for a real form element, not for a string that says 'form'", () => {
  // The looser test this replaces matched `a.setAttribute("form", e.id)` inside
  // React's own DOM shim. It happened to agree with reality on the donor it was
  // written against, which is the most dangerous kind of wrong — on a donor
  // with no form it would have printed "This site has a contact form" onto a
  // customer's privacy page.
  const reactShim = { "assets/app.js": 'var a=document.createElement("input");a.setAttribute("form",e.id);' };
  assert.equal(P.observeSiteDataSurfaces({ fileTexts: { "index.html": SHELL }, assetTexts: reactShim }).form, false);
  const realForm = { "assets/app.js": 'u.jsxs("form",{onSubmit:r,children:[]})' };
  assert.equal(P.observeSiteDataSurfaces({ fileTexts: { "index.html": SHELL }, assetTexts: realForm }).form, true);
  assert.equal(P.observeSiteDataSurfaces({ fileTexts: { "index.html": "<form></form>" }, assetTexts: {} }).form, true);
});

test("legal: the brand accent is read from the compiled stylesheet, not guessed", () => {
  // MEASURED: index.html on this lane declares only `--wss-a: var(--accent,199
  // 89% 48%)` — a reference to the FALLBACK — while the real palette lives in
  // the compiled CSS as an HSL triple. A hex-only reader of index.html finds
  // nothing and silently ships the stylesheet's generic blue on every mirror.
  assert.match(P.brandAccentBlock("--accent: 36 97% 62%"), /--accent:36 97% 62%/);
  assert.match(P.brandAccentBlock("--accent:#e8b45e"), /--accent:3[0-9] \d+% \d+%/);
  assert.equal(P.brandAccentBlock("--wss-a: var(--accent,199 89% 48%)"), "", "a reference to the fallback is not a palette");
  assert.equal(P.brandAccentBlock(""), "");
});

// ---------------------------------------------------------------------------
// REVERSIBILITY — including the files a plan CREATES
// ---------------------------------------------------------------------------
test("undo: a created file is recorded so that 'put it back' can remove it", () => {
  // Restoring index.html alone would take the link away while /privacy kept
  // serving. The undo for a file that did not exist is its absence, so the
  // manifest carries the names and applyUndo deletes them from the archive AND
  // drops them from the deploy — dropping the key alone is not enough, because
  // the next edit rebuilds the deploy set from the archive.
  assert.match(SRC, /created,\s*$/m);
  assert.match(SRC, /for \(const rel of restored\.created \|\| \[\]\) \{/);
  assert.match(SRC, /await removeArchivedObject\(siteSlug, rel\)/);
  assert.match(SRC, /delete files\[rel\]/);
});

test("undo: deletion is reachable only from an undo, never from a plan op", () => {
  // The one DELETE this system can issue must not be addressable by anything a
  // caller says. It takes a slug and a path that a previous snapshot manifest
  // recorded as created.
  const calls = SRC.match(/removeArchivedObject\(/g) || [];
  assert.equal(calls.length, 2, "one definition, one call site");
  const undoBody = SRC.slice(SRC.indexOf("async function applyUndo"));
  assert.ok(undoBody.includes("removeArchivedObject(siteSlug, rel)"), "the only call site is inside applyUndo");
});

// ---------------------------------------------------------------------------
// READ-AFTER-WRITE — the silent rollback
// ---------------------------------------------------------------------------
test("the archive is read through a cache-buster, and the write is proved before deploying", () => {
  // MEASURED on the live mirror while building this: three edits applied in
  // sequence, each reporting success, and the live site ended up with none of
  // the first two. The archive is fronted by an edge cache that returns
  // `cf-cache-status: HIT` with the PREVIOUS bytes even though the response
  // says no-cache — write then read four times, all four stale. Because every
  // edit rebuilds the WHOLE deploy from the archive, one stale read writes the
  // old copy back and redeploys it, silently reverting a change a customer was
  // told was live. A unique query parameter read FRESH 3/3.
  assert.match(SRC, /async function downloadFresh/);
  assert.match(SRC, /wssfresh=/);
  // Nothing on this path may use the plain, cacheable reader.
  assert.ok(!/await download\(/.test(SRC), "every archive read here must be cache-busted");
  // And the archive must be proved to hold what we sent, before the deploy.
  const tail = SRC.slice(SRC.indexOf("const undo = await snapshot("));
  const readback = tail.indexOf("assertArchiveMatches");
  const deploy = tail.indexOf("vercelDeploy");
  assert.ok(readback > 0 && readback < deploy, "readback must run before the deploy");
});

// ---------------------------------------------------------------------------
// THE PLANNER'S VIEW
// ---------------------------------------------------------------------------
test("the planner is shown the words it may re-word, and told why replace_text cannot reach them", () => {
  const ctx = P.buildPlannerContext({
    facts: { businessName: "Rimrock Plumbing" },
    rels: ["index.html"],
    anchors: [],
    elements: [],
    assets: [],
    copy: P.buildCopyCatalog({ "assets/index-abc.js": BUNDLE }),
  });
  assert.match(ctx, /WORDS ON THE PAGE/);
  assert.match(ctx, /A small workshop, just for you\./);
  assert.match(ctx, /replace_text cannot reach them/);
});

test("every new op is declared in the contract the planner is actually given", () => {
  for (const op of ["replace_copy", "copy_block", "tracking_tag", "swap_image", "legal_page"]) {
    assert.match(P.PLAN_CONTRACT, new RegExp(`"op":"${op}"`), `${op} must be offered to the planner`);
  }
  // A terms of service must be refused in the contract too, not only in code,
  // so the planner does not spend a call proposing one.
  assert.match(P.PLAN_CONTRACT, /terms of service is a contract and is refused/);
});
