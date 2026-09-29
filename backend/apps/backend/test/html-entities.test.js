"use strict";

// test/html-entities.test.js — THE ENTITY BOUNDARY, LOCKED.
//
// Flint Plumbing shipped live cards reading "Hydrostatic Tests &#038; Tunneling
// Repair" — the entity VISIBLE as text — while every gate in the build reported
// passed. The cause was a scraper that knew two named entities and no numeric
// ones, so WordPress's `&#038;` was stored verbatim as part of the service name
// and then correctly escaped at render into `&amp;#038;`.
//
// This suite locks four properties:
//   1. DECODE ONCE   the scrape boundary decodes numeric, hex and named
//                    references, and decodes them exactly one time.
//   2. NO LOOP       a genuinely double-encoded source string stays inert text.
//                    "&amp;lt;script&amp;gt;" must never become a live tag.
//   3. NO XSS        a decoded "<" is a real character in STORAGE and an escaped
//                    one in OUTPUT. Storage holds text; the renderer escapes.
//   4. UNREACHABLE   no entity literal survives the full scrape -> resolve ->
//                    inject -> render path into what a reader's eye receives.
//
// No network. The site is a fixture served by a stub fetch.

const test = require("node:test");
const assert = require("node:assert/strict");

const { decodeEntitiesOnce, decodeEntitiesDeep, residualEntities } = require("../lib/mirror-engine/html-entities");
const { htmlToVisibleText } = require("../lib/mirror-engine/visible-text");
const vf = require("../lib/mirror-engine/verified-facts");
const { buildContentHtml } = require("../lib/mirror-engine/content-inject");

// ---------------------------------------------------------------------------
// A browser model. Given HTML we emitted, return the characters a visitor SEES.
// Deliberately not htmlToVisibleText: the thing under test must not also be the
// thing that judges the test. Tags out, references decoded once, done.
// ---------------------------------------------------------------------------
function asPainted(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d{1,8}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, b) => {
      if (b[0] === "#") {
        const hex = b[1] === "x" || b[1] === "X";
        return String.fromCodePoint(Number.parseInt(hex ? b.slice(2) : b.slice(1), hex ? 16 : 10));
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" }[b] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 1. THE DECODER ITSELF
// ---------------------------------------------------------------------------

test("decodes the numeric reference WordPress actually emits for an ampersand", () => {
  assert.equal(decodeEntitiesOnce("Hydrostatic Tests &#038; Tunneling Repair"), "Hydrostatic Tests & Tunneling Repair");
  assert.equal(decodeEntitiesOnce("Commercial &#038; Multi-Family"), "Commercial & Multi-Family");
});

test("decodes decimal, hex and named references, and the leading-zero forms", () => {
  assert.equal(decodeEntitiesOnce("a &#038; b"), "a & b");
  assert.equal(decodeEntitiesOnce("a &#38; b"), "a & b");
  assert.equal(decodeEntitiesOnce("a &#x26; b"), "a & b");
  assert.equal(decodeEntitiesOnce("a &#X26; b"), "a & b");
  assert.equal(decodeEntitiesOnce("a &amp; b"), "a & b");
  assert.equal(decodeEntitiesOnce("O&#039;Brien"), "O'Brien");
  assert.equal(decodeEntitiesOnce("O&#8217;Brien"), "O\u2019Brien");
  assert.equal(decodeEntitiesOnce("O&rsquo;Brien"), "O\u2019Brien");
  assert.equal(decodeEntitiesOnce("24&#047;7"), "24/7");
  assert.equal(decodeEntitiesOnce("&#40;520&#41; 555-0142"), "(520) 555-0142");
});

test("legacy Windows-1252 numeric references decode to the punctuation they mean, not a control char", () => {
  // &#146; is 0x92 — a C1 control if read literally, a right single quote in
  // every CMS that emits it. A control character inside a stored service name
  // is invisible to a gate and audible to a screen reader.
  assert.equal(decodeEntitiesOnce("Dan&#146;s Plumbing"), "Dan\u2019s Plumbing");
  assert.equal(decodeEntitiesOnce("A&#150;B"), "A\u2013B");
  for (const ch of decodeEntitiesOnce("Dan&#146;s Plumbing")) {
    assert.ok(ch.codePointAt(0) > 0x1f, "no control character survives the decode");
  }
});

test("an unknown or malformed reference is left exactly as written — we do not guess", () => {
  assert.equal(decodeEntitiesOnce("Tool &widget; Co"), "Tool &widget; Co");
  assert.equal(decodeEntitiesOnce("Q&A"), "Q&A");
  assert.equal(decodeEntitiesOnce("?a=1&copy=2"), "?a=1&copy=2", "no semicolon, no decode: a query string is not entity syntax");
  assert.equal(decodeEntitiesOnce("&#xZZ;"), "&#xZZ;");
  assert.equal(decodeEntitiesOnce("&#99999999;"), "&#99999999;", "beyond U+10FFFF is not a code point");
});

test("prototype member names are not entities", () => {
  assert.equal(decodeEntitiesOnce("&constructor;"), "&constructor;");
  assert.equal(decodeEntitiesOnce("&toString;"), "&toString;");
  assert.equal(decodeEntitiesOnce("&__proto__;"), "&__proto__;");
});

// ---------------------------------------------------------------------------
// 2. ONE PASS — the property that makes this safe rather than merely correct
// ---------------------------------------------------------------------------

test("decoding is a SINGLE pass: a double-encoded source string stays inert text", () => {
  // This is the load-bearing test. A "decode until stable" loop would turn
  // every line below into live markup the business never wrote.
  assert.equal(decodeEntitiesOnce("&amp;#038;"), "&#038;");
  assert.equal(decodeEntitiesOnce("&amp;amp;"), "&amp;");
  assert.equal(decodeEntitiesOnce("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
  assert.equal(decodeEntitiesOnce("&amp;#60;img onerror=x&amp;#62;"), "&#60;img onerror=x&#62;");
});

test("decodeEntitiesOnce is not idempotent by accident — it is single-pass by construction", () => {
  const once = decodeEntitiesOnce("&amp;lt;script&amp;gt;");
  const twice = decodeEntitiesOnce(once);
  assert.equal(once, "&lt;script&gt;");
  assert.equal(twice, "<script>", "a SECOND call does decode further — which is why the code path calls it once and only once");
});

test("decodeEntitiesDeep reaches a shared node down two branches (no half-decode)", () => {
  const shared = { addressLocality: "Buda &#038; Kyle" };
  const graph = [{ address: shared }, shared];
  const out = decodeEntitiesDeep(graph);
  assert.equal(out[0].address.addressLocality, "Buda & Kyle");
  assert.equal(out[1].addressLocality, "Buda & Kyle", "the second reference must not come back undecoded");
});

test("decodeEntitiesDeep survives a cycle and leaves object keys alone", () => {
  const a = { "name&#038;": "X &#038; Y" };
  a.self = a;
  const out = decodeEntitiesDeep(a);
  assert.equal(out["name&#038;"], "X & Y");
  assert.ok("name&#038;" in out, "a key is a field name we chose, not scraped copy");
});

// ---------------------------------------------------------------------------
// 3. THE SCRAPE BOUNDARY — firstPartySite with a stub fetch
// ---------------------------------------------------------------------------

const FIXTURE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "Plumber"],
  name: "Flint Plumbing &#038; Drain LLC",
  telephone: "(512) 971-2445",
  url: "https://flintplumb.example/?utm=a&amp;b=c",
  address: { "@type": "PostalAddress", streetAddress: "1132 Oyster Creek", addressLocality: "Buda", addressRegion: "TX", postalCode: "78610" },
})}</script>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [{
    "@type": "Question",
    name: "Do you handle slab leaks &#038; repipes?",
    acceptedAnswer: { "@type": "Answer", text: "Yes &#8212; we locate, isolate &#038; repair slab leaks. Call <a href='/contact'>our team</a> today." },
  }],
})}</script>
</head><body>
<nav>
  <a href="/hydrostatic-tests-tunneling-repair/">Hydrostatic Tests &#038; Tunneling Repair</a>
  <a href="/water-leaks-slab/">Water Leaks &#038; Slab</a>
  <a href="/commercial/">Commercial &amp; Multi-Family</a>
  <a href="/drain-clearing/">Drains &#8217;n Sewers</a>
  <a href="/emergency/">24&#047;7 Emergency Service</a>
  <!-- markup the author meant a reader to SEE, not a tag -->
  <a href="/markup-literal/">Using &lt;strong&gt; Tags</a>
  <a href="/about/">About Us</a>
  <!-- A PROMOTIONS page, not a service. It carries an entity too, so the decode
       is still exercised on this path even though the label is refused. -->
  <a href="/specials/">Specials &#8217;n Incentives</a>
</nav>
</body></html>`;

function stubFetch(html) {
  return async () => ({ ok: true, status: 200, text: async () => html });
}

test("SCRAPE BOUNDARY: no entity literal is ever STORED as part of a service name", async () => {
  const rec = await vf.firstPartySite({ website: "https://flintplumb.example/", fetchImpl: stubFetch(FIXTURE_HTML) });
  assert.equal(rec.status, "ok");
  const names = rec.observations.services.map((s) => s.name);

  assert.ok(names.includes("Hydrostatic Tests & Tunneling Repair"), `got ${JSON.stringify(names)}`);
  assert.ok(names.includes("Water Leaks & Slab"));
  assert.ok(names.includes("Commercial & Multi-Family"));
  assert.ok(names.includes("Drains \u2019n Sewers"), `got ${JSON.stringify(names)}`);
  assert.ok(names.includes("24/7 Emergency Service"));
  // A promotions page is not a service, however cleanly its label decodes.
  assert.ok(!names.some((n) => /Specials/i.test(n)), `a /specials page is not a service: ${JSON.stringify(names)}`);

  for (const n of names) {
    assert.equal(residualEntities(n).length, 0, `stored service name still carries entity syntax: ${JSON.stringify(n)}`);
  }
});

test("SCRAPE BOUNDARY: authored markup text stays text — it is not turned into a tag and deleted", async () => {
  const rec = await vf.firstPartySite({ website: "https://flintplumb.example/", fetchImpl: stubFetch(FIXTURE_HTML) });
  const names = rec.observations.services.map((s) => s.name);
  assert.ok(names.includes("Using <strong> Tags"), JSON.stringify(names));
});

test("SCRAPE BOUNDARY: JSON-LD name, url, address and FAQ text are decoded too", async () => {
  const rec = await vf.firstPartySite({ website: "https://flintplumb.example/", fetchImpl: stubFetch(FIXTURE_HTML) });
  assert.equal(rec.observations.business_name, "Flint Plumbing & Drain LLC");
  assert.equal(rec.observations.current_website, "https://flintplumb.example/?utm=a&b=c");
  const faq = rec.observations.faqs[0];
  assert.equal(faq.q, "Do you handle slab leaks & repipes?");
  assert.match(faq.a, /Yes \u2014 we locate, isolate & repair slab leaks\./);
  assert.equal(residualEntities(faq.q).length + residualEntities(faq.a).length, 0);
  assert.ok(!/<a\b/i.test(faq.a), "inline markup is stripped before the decode, so it cannot be reconstituted");
});

// ---------------------------------------------------------------------------
// 4. THE FULL PATH — scrape -> resolve -> inject -> what the eye receives
// ---------------------------------------------------------------------------

test("UNREACHABLE: a double-encoded entity in scraped content cannot reach rendered output", async () => {
  const GOOGLE = vf.OBSERVER.GOOGLE_GBP;
  const resolution = await vf.resolveVerifiedFacts({
    prospect: { business_name: "Flint Plumbing LLC", city: "Buda", state: "TX", industry: "plumbing", website: "https://flintplumb.example/" },
    sources: [
      // One independent observer so the NAP fields resolve, plus the real
      // first-party adapter reading the fixture.
      async () => ({
        id: "places_stub", observer: GOOGLE, transport: "stub", status: "ok", requests: 0,
        observations: { business_name: "Flint Plumbing LLC", phone: "(512) 971-2445", city: "Buda", state: "TX", postal_code: "78610" },
        place_types: ["plumber"],
      }),
      vf.firstPartySite,
    ],
    deps: { fetchImpl: stubFetch(FIXTURE_HTML) },
  });

  const services = resolution.content.services || [];
  assert.ok(services.length >= 5, `expected the fixture's services, got ${services.length}`);

  const html = buildContentHtml({
    content: resolution.content,
    facts: resolution.facts,
    phoneDigits: "5129712445",
  });
  assert.ok(html.length > 0, "the content block must actually render");

  // THE MARKUP is correctly escaped — an ampersand SHOULD be &amp; in the file.
  assert.ok(html.includes("Hydrostatic Tests &amp; Tunneling Repair"), "the renderer must escape, not skip escaping");

  // THE PAINTED TEXT is what the customer reads. Zero entity syntax there.
  const painted = asPainted(html);
  assert.ok(painted.includes("Hydrostatic Tests & Tunneling Repair"), painted.slice(0, 400));
  assert.equal(painted.includes("&#038;"), false, "the Flint defect, exactly");
  assert.equal(painted.includes("&amp;"), false);
  assert.deepEqual(residualEntities(painted), [], `entity syntax visible to a reader: ${JSON.stringify(residualEntities(painted))}`);
});

test("NO XSS: a decoded angle bracket is a character in storage and an escaped one in output", async () => {
  const HOSTILE = `<!doctype html><html><body><nav>
    <a href="/a/">&lt;img src=x onerror=alert(1)&gt; Repair</a>
    <a href="/b/">&#60;script&#62;alert(2)&#60;/script&#62; Service</a>
    <a href="/c/">&amp;lt;script&amp;gt;alert(3)&amp;lt;/script&amp;gt; Text</a>
  </nav></body></html>`;
  const rec = await vf.firstPartySite({ website: "https://hostile.example/", fetchImpl: stubFetch(HOSTILE) });
  const names = rec.observations.services.map((s) => s.name);

  // STORAGE holds the real characters — that is the point of decoding once.
  assert.ok(names.some((n) => n.includes("<img src=x onerror=alert(1)>")), JSON.stringify(names));
  assert.ok(names.some((n) => n.includes("<script>alert(2)</script>")), JSON.stringify(names));

  const html = buildContentHtml({
    content: { services: names.map((name) => ({ name })) },
    facts: { business_name: "Hostile Co", city: "Buda", state: "TX" },
    phoneDigits: "",
  });

  // OUTPUT holds none of it live. The wrapper legitimately ships OUR OWN
  // scripts now (HOIST_UNDER_HERO_JS, CAROUSEL_JS, APPLE_TWIN_JS — commit
  // 9a63506 put the trust-strip hoist inside buildContentHtml), so "no
  // <script> anywhere" stopped being the property. The property is: every
  // LIVE script is one of ours and carries no scraped payload, and outside
  // those, no scraped byte is a tag, a handler or an executable anything.
  const liveScripts = [...html.matchAll(/<script>[\s\S]*?<\/script>/gi)].map((m) => m[0]);
  assert.ok(liveScripts.length >= 1, "the wrapper ships its own scripts");
  for (const s of liveScripts) {
    assert.match(s, /trust|wss-rv|wss-apple/i, "every live script must be one of our own");
    assert.equal(/alert\s*\(/.test(s), false, "no scraped payload may reach a live script");
  }
  const outsideScripts = html.replace(/<script>[\s\S]*?<\/script>/gi, "");
  assert.equal(/<img\b/i.test(outsideScripts), false, "a scraped <img> must not become a tag in our output");
  assert.equal(/<script\b/i.test(outsideScripts), false, "a scraped <script> must not become a tag in our output");
  assert.equal(/<[^>]*\bon[a-z]+\s*=/i.test(outsideScripts), false, "no event handler may appear in attribute position");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "it ships as visible, inert text");

  // And what the eye receives is the literal text the scrape found.
  const painted = asPainted(html);
  assert.ok(painted.includes("<img src=x onerror=alert(1)> Repair"));
});

// ---------------------------------------------------------------------------
// 5. THE TRIPWIRE — the gate that would have failed the Flint build
// ---------------------------------------------------------------------------

test("residualEntities finds what the Flint gates missed, and stays quiet on clean copy", () => {
  assert.deepEqual(residualEntities("Hydrostatic Tests &#038; Tunneling Repair"), ["&#038;"]);
  assert.deepEqual(residualEntities("Water Heaters & Drains — 24/7"), []);
  assert.deepEqual(residualEntities("Call (512) 971-2445 today. Q&A welcome."), [], "a bare ampersand is text, not a reference");
  assert.equal(residualEntities("&#038; &#038; &amp;").length, 2, "distinct literals only");
});

test("the visible-text extractor decodes numeric references, so a leak scan sees what a browser shows", () => {
  const text = htmlToVisibleText("<body><p>Call &#40;520&#41; 555-0142 for M. Forchione</p></body>");
  assert.ok(text.includes("(520) 555-0142"), text);
  assert.equal(residualEntities(text).length, 0);
});
